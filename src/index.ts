#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ToolSchema
} from "@modelcontextprotocol/sdk/types.js";

import fs from "fs/promises";
import path from "path";
import os from 'os';
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { diffLines, createTwoFilesPatch } from "diff";
import { minimatch } from "minimatch";

// Procesamiento de argumentos de línea de comandos
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Uso: mi-servidor-mcp <directorio-de-trabajo> [directorio-adicionales...]");
    process.exit(1);
}


//Implementación de las funciones de seguridad
// Normalizar las rutas de manera consistente
function normalizePath(p: string): string {
    return path.normalize(p);
}

function expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return filepath;
}

// Almacenar directorios permitidos en forma normalizada
const allowedDirectories = args.map(dir =>
    normalizePath(path.resolve(expandHome(dir)))
);

// Validar que todos los directorios existan y sean accesibles
async () => {
    await Promise.all(args.map(async (dir) => {
        try {
            const stats = await fs.stat(expandHome(dir));
            if (!stats.isDirectory()) {
                console.error(`Error: ${dir} no es un directorio`);
                process.exit(1);
            }
        } catch (error) {
            console.error(`Error al acceder al directorio ${dir}:`, error);
            process.exit(1);
        }
    }));
};

// Funciones de seguridad
async function validatePath(requestedPath: string): Promise<string> {
    const expandedPath = expandHome(requestedPath);
    const absolute = path.isAbsolute(expandedPath)
        ? path.resolve(expandedPath)
        : path.resolve(process.cwd(), expandedPath);

    const normalizedRequested = normalizePath(absolute);

    // Verificar si la ruta está dentro de los directorios permitidos
    const isAllowed = allowedDirectories.some(dir => normalizedRequested.startsWith(dir));
    if (!isAllowed) {
        throw new Error(`Acceso denegado - ruta fuera de los directorios permitidos: ${absolute} no está en ${allowedDirectories.join(', ')}`);
    }

    // Manejar enlaces simbólicos verificando su ruta real
    try {
        const realPath = await fs.realpath(absolute);
        const normalizedReal = normalizePath(realPath);
        const isRealPathAllowed = allowedDirectories.some(dir => normalizedReal.startsWith(dir));
        if (!isRealPathAllowed) {
            throw new Error("Acceso denegado - destino del enlace simbólico fuera de los directorios permitidos");
        }
        return realPath;
    } catch (error) {
        // Para archivos nuevos que todavía no existen, verificar el directorio padre
        const parentDir = path.dirname(absolute);
        try {
            const realParentPath = await fs.realpath(parentDir);
            const normalizedParent = normalizePath(realParentPath);
            const isParentAllowed = allowedDirectories.some(dir => normalizedParent.startsWith(dir));
            if (!isParentAllowed) {
                throw new Error("Acceso denegado - directorio padre fuera de los directorios permitidos");
            }
            return absolute;
        } catch {
            throw new Error(`El directorio padre no existe: ${parentDir}`);
        }
    }
}


//Paso 4: Definición de los esquemas para las herramientas

// Definiciones de esquemas
const ReadFileArgsSchema = z.object({
    path: z.string(),
});

const ReadMultipleFilesArgsSchema = z.object({
    paths: z.array(z.string()),
});

const WriteFileArgsSchema = z.object({
    path: z.string(),
    content: z.string(),
});

const EditOperation = z.object({
    oldText: z.string().describe('Texto a buscar - debe coincidir exactamente'),
    newText: z.string().describe('Texto con el que reemplazar')
});

const EditFileArgsSchema = z.object({
    path: z.string(),
    edits: z.array(EditOperation),
    dryRun: z.boolean().default(false).describe('Vista previa de cambios usando formato diff de git')
});

const CreateDirectoryArgsSchema = z.object({
    path: z.string(),
});

const ListDirectoryArgsSchema = z.object({
    path: z.string(),
});

const DirectoryTreeArgsSchema = z.object({
    path: z.string(),
});

const MoveFileArgsSchema = z.object({
    source: z.string(),
    destination: z.string(),
});

const SearchFilesArgsSchema = z.object({
    path: z.string(),
    pattern: z.string(),
    excludePatterns: z.array(z.string()).optional().default([])
});

const GetFileInfoArgsSchema = z.object({
    path: z.string(),
});

// Nuevos esquemas para copiar y pegar archivos
const CopyFileArgsSchema = z.object({
    source: z.string(),
    destination: z.string(),
});

const CopyDirectoryArgsSchema = z.object({
    source: z.string(),
    destination: z.string(),
    recursive: z.boolean().default(true).describe('Si es true, copia el directorio completo recursivamente'),
});

const DeleteFileArgsSchema = z.object({
    path: z.string(),
    force: z.boolean().default(false).describe('Si es true, elimina incluso directorios no vacíos')
});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

interface FileInfo {
    size: number;
    created: Date;
    modified: Date;
    accessed: Date;
    isDirectory: boolean;
    isFile: boolean;
    permissions: string;
}

//Paso 5: Configuración del servidor MCP

// Configuración del servidor
const server = new Server(
    {
        name: "mi-servidor-filesystem",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    },
);

// Implementaciones de funciones útiles
async function getFileStats(filePath: string): Promise<FileInfo> {
    const stats = await fs.stat(filePath);
    return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: stats.mode.toString(8).slice(-3),
    };
}

async function searchFiles(
    rootPath: string,
    pattern: string,
    excludePatterns: string[] = []
): Promise<string[]> {
    const results: string[] = [];

    async function search(currentPath: string) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);

            try {
                // Validar cada ruta antes de procesarla
                await validatePath(fullPath);

                // Verificar si la ruta coincide con algún patrón de exclusión
                const relativePath = path.relative(rootPath, fullPath);
                const shouldExclude = excludePatterns.some(pattern => {
                    const globPattern = pattern.includes('*') ? pattern : `**/${pattern}/**`;
                    return minimatch(relativePath, globPattern, { dot: true });
                });

                if (shouldExclude) {
                    continue;
                }

                if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
                    results.push(fullPath);
                }

                if (entry.isDirectory()) {
                    await search(fullPath);
                }
            } catch (error) {
                // Saltar rutas inválidas durante la búsqueda
                continue;
            }
        }
    }

    await search(rootPath);
    return results;
}

// Funciones útiles para edición y diff de archivos
function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

function createUnifiedDiff(originalContent: string, newContent: string, filepath: string = 'file'): string {
    // Asegurar finales de línea consistentes para el diff
    const normalizedOriginal = normalizeLineEndings(originalContent);
    const normalizedNew = normalizeLineEndings(newContent);

    return createTwoFilesPatch(
        filepath,
        filepath,
        normalizedOriginal,
        normalizedNew,
        'original',
        'modified'
    );
}

async function applyFileEdits(
    filePath: string,
    edits: Array<{ oldText: string, newText: string }>,
    dryRun = false
): Promise<string> {
    // Leer contenido del archivo y normalizar finales de línea
    const content = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));

    // Aplicar ediciones secuencialmente
    let modifiedContent = content;
    for (const edit of edits) {
        const normalizedOld = normalizeLineEndings(edit.oldText);
        const normalizedNew = normalizeLineEndings(edit.newText);

        // Si existe una coincidencia exacta, usarla
        if (modifiedContent.includes(normalizedOld)) {
            modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
            continue;
        }

        // De lo contrario, intentar coincidencia línea por línea con flexibilidad para espacios en blanco
        const oldLines = normalizedOld.split('\n');
        const contentLines = modifiedContent.split('\n');
        let matchFound = false;

        for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
            const potentialMatch = contentLines.slice(i, i + oldLines.length);

            // Comparar líneas con espacios en blanco normalizados
            const isMatch = oldLines.every((oldLine, j) => {
                const contentLine = potentialMatch[j];
                return oldLine.trim() === contentLine.trim();
            });

            if (isMatch) {
                // Preservar indentación original de la primera línea
                const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
                const newLines = normalizedNew.split('\n').map((line, j) => {
                    if (j === 0) return originalIndent + line.trimStart();
                    // Para líneas subsiguientes, intentar preservar indentación relativa
                    const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || '';
                    const newIndent = line.match(/^\s*/)?.[0] || '';
                    if (oldIndent && newIndent) {
                        const relativeIndent = newIndent.length - oldIndent.length;
                        return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
                    }
                    return line;
                });

                contentLines.splice(i, oldLines.length, ...newLines);
                modifiedContent = contentLines.join('\n');
                matchFound = true;
                break;
            }
        }

        if (!matchFound) {
            throw new Error(`No se pudo encontrar una coincidencia exacta para la edición:\n${edit.oldText}`);
        }
    }

    // Crear diff unificado
    const diff = createUnifiedDiff(content, modifiedContent, filePath);

    // Dar formato al diff con número apropiado de backticks
    let numBackticks = 3;
    while (diff.includes('`'.repeat(numBackticks))) {
        numBackticks++;
    }
    const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`;

    if (!dryRun) {
        await fs.writeFile(filePath, modifiedContent, 'utf-8');
    }

    return formattedDiff;
}

// Función recursiva para copiar directorios
async function copyDir(src: string, dest: string, recursive = true) {
    // Crear el directorio de destino
    await fs.mkdir(dest, { recursive: true });

    // Leer contenidos del directorio
    const entries = await fs.readdir(src, { withFileTypes: true });

    // Copiar cada elemento
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            // Si es directorio y recursive es true, copiar recursivamente
            if (recursive) {
                await copyDir(srcPath, destPath, recursive);
            }
        } else {
            // Si es archivo, copiar
            await fs.copyFile(srcPath, destPath);

            // Preservar permisos y fechas
            const stats = await fs.stat(srcPath);
            await fs.utimes(destPath, stats.atime, stats.mtime);
            try {
                await fs.chmod(destPath, stats.mode);
            } catch (error) {
                console.error(`No se pudieron establecer los permisos para ${destPath}:`, error);
            }
        }
    }

    // Preservar permisos y fechas del directorio raíz
    const stats = await fs.stat(src);
    await fs.utimes(dest, stats.atime, stats.mtime);
    try {
        await fs.chmod(dest, stats.mode);
    } catch (error) {
        console.error(`No se pudieron establecer los permisos para ${dest}:`, error);
    }
}

//Paso 6: Configuración de los manejadores de solicitudes

// Configurar manejador de ListTools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "read_file",
                description:
                    "Lee el contenido completo de un archivo del sistema de archivos. " +
                    "Maneja varias codificaciones de texto y proporciona mensajes de error detallados " +
                    "si el archivo no se puede leer. Usa esta herramienta cuando necesites examinar " +
                    "el contenido de un solo archivo. Solo funciona dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(ReadFileArgsSchema) as ToolInput,
            },
            {
                name: "read_multiple_files",
                description:
                    "Lee el contenido de múltiples archivos simultáneamente. Esto es más " +
                    "eficiente que leer archivos uno por uno cuando necesitas analizar " +
                    "o comparar múltiples archivos. El contenido de cada archivo se devuelve con su " +
                    "ruta como referencia. Las lecturas fallidas de archivos individuales no detendrán " +
                    "toda la operación. Solo funciona dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema) as ToolInput,
            },
            {
                name: "write_file",
                description:
                    "Crea un nuevo archivo o sobrescribe completamente un archivo existente con nuevo contenido. " +
                    "Úsalo con precaución, ya que sobrescribirá archivos existentes sin advertencia. " +
                    "Maneja contenido de texto con codificación adecuada. Solo funciona dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(WriteFileArgsSchema) as ToolInput,
            },
            {
                name: "edit_file",
                description:
                    "Realiza ediciones basadas en líneas a un archivo de texto. Cada edición reemplaza " +
                    "secuencias exactas de líneas con nuevo contenido. Devuelve un diff en estilo git " +
                    "mostrando los cambios realizados. Solo funciona dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(EditFileArgsSchema) as ToolInput,
            },
            {
                name: "create_directory",
                description:
                    "Crea un nuevo directorio o asegura que un directorio exista. Puede crear múltiples " +
                    "directorios anidados en una operación. Si el directorio ya existe, " +
                    "esta operación tendrá éxito silenciosamente. Perfecto para configurar estructuras " +
                    "de directorios para proyectos o asegurar que existan las rutas requeridas. Solo funciona dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema) as ToolInput,
            },
            {
                name: "list_directory",
                description:
                    "Obtiene un listado detallado de todos los archivos y directorios en una ruta específica. " +
                    "Los resultados distinguen claramente entre archivos y directorios con prefijos [FILE] y [DIR]. " +
                    "Esta herramienta es esencial para comprender la estructura de directorios y " +
                    "encontrar archivos específicos dentro de un directorio. Solo funciona dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput,
            },
            {
                name: "directory_tree",
                description:
                    "Obtiene una vista de árbol recursiva de archivos y directorios como una estructura JSON. " +
                    "Cada entrada incluye 'name', 'type' (file/directory), y 'children' para directorios. " +
                    "Los archivos no tienen array children, mientras que los directorios siempre tienen un array children (que puede estar vacío). " +
                    "La salida se formatea con indentación de 2 espacios para legibilidad. Solo funciona dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema) as ToolInput,
            },
            {
                name: "move_file",
                description:
                    "Mueve o renombra archivos y directorios. Puede mover archivos entre directorios " +
                    "y renombrarlos en una sola operación. Si el destino existe, la " +
                    "operación fallará. Funciona en diferentes directorios y puede usarse " +
                    "para renombrar simplemente dentro del mismo directorio. Tanto el origen como el destino deben estar dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(MoveFileArgsSchema) as ToolInput,
            },
            {
                name: "search_files",
                description:
                    "Busca recursivamente archivos y directorios que coincidan con un patrón. " +
                    "Busca a través de todos los subdirectorios desde la ruta de inicio. La búsqueda " +
                    "no distingue entre mayúsculas y minúsculas y coincide con nombres parciales. Devuelve rutas completas a todos " +
                    "los elementos coincidentes. Genial para encontrar archivos cuando no conoces su ubicación exacta. " +
                    "Solo busca dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(SearchFilesArgsSchema) as ToolInput,
            },
            {
                name: "get_file_info",
                description:
                    "Recupera metadatos detallados sobre un archivo o directorio. Devuelve información completa " +
                    "incluyendo tamaño, hora de creación, hora de última modificación, permisos, " +
                    "y tipo. Esta herramienta es perfecta para comprender las características de los archivos " +
                    "sin leer el contenido real. Solo funciona dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(GetFileInfoArgsSchema) as ToolInput,
            },
            {
                name: "copy_file",
                description:
                    "Copia un archivo de una ubicación a otra. " +
                    "Preserva metadatos como fechas de modificación y permisos. " +
                    "Si el destino ya existe, la operación fallará. Tanto el origen como " +
                    "el destino deben estar dentro de los directorios permitidos.",
                inputSchema: zodToJsonSchema(CopyFileArgsSchema) as ToolInput,
            },
            {
                name: "copy_directory",
                description:
                    "Copia un directorio completo, incluyendo todos sus contenidos, de una ubicación a otra. " +
                    "La opción 'recursive' permite copiar todos los subdirectorios y archivos. " +
                    "Preserva metadatos como fechas de modificación y permisos. " +
                    "Si el destino ya existe, la operación fallará. Tanto el origen como " +
                    "el destino deben estar dentro de los directorios permitidos.",
                inputSchema: zodToJsonSchema(CopyDirectoryArgsSchema) as ToolInput,
            },
            {
                name: "delete_file",
                description:
                    "Elimina un archivo o directorio. Si se trata de un directorio no vacío, " +
                    "la operación fallará a menos que se establezca la opción 'force' en true. " +
                    "Usa con precaución, ya que esta operación no puede deshacerse. " +
                    "Solo funciona dentro de directorios permitidos.",
                inputSchema: zodToJsonSchema(DeleteFileArgsSchema) as ToolInput,
            },
            {
                name: "list_allowed_directories",
                description:
                    "Devuelve la lista de directorios a los que este servidor tiene permitido acceder. " +
                    "Usa esto para comprender qué directorios están disponibles antes de intentar acceder a archivos.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            },
        ],
    };
});

//Paso 7: Implementación de los manejadores de herramientas

// Configurar manejador de CallTool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const { name, arguments: args } = request.params;

        switch (name) {
            case "read_file": {
                const parsed = ReadFileArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para read_file: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                const content = await fs.readFile(validPath, "utf-8");
                return {
                    content: [{ type: "text", text: content }],
                };
            }

            case "read_multiple_files": {
                const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para read_multiple_files: ${parsed.error}`);
                }
                const results = await Promise.all(
                    parsed.data.paths.map(async (filePath: string) => {
                        try {
                            const validPath = await validatePath(filePath);
                            const content = await fs.readFile(validPath, "utf-8");
                            return `${filePath}:\n${content}\n`;
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            return `${filePath}: Error - ${errorMessage}`;
                        }
                    }),
                );
                return {
                    content: [{ type: "text", text: results.join("\n---\n") }],
                };
            }

            case "write_file": {
                const parsed = WriteFileArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para write_file: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                await fs.writeFile(validPath, parsed.data.content, "utf-8");
                return {
                    content: [{ type: "text", text: `Archivo escrito exitosamente en ${parsed.data.path}` }],
                };
            }

            case "edit_file": {
                const parsed = EditFileArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para edit_file: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                const result = await applyFileEdits(validPath, parsed.data.edits, parsed.data.dryRun);
                return {
                    content: [{ type: "text", text: result }],
                };
            }

            case "create_directory": {
                const parsed = CreateDirectoryArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para create_directory: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                await fs.mkdir(validPath, { recursive: true });
                return {
                    content: [{ type: "text", text: `Directorio creado exitosamente en ${parsed.data.path}` }],
                };
            }

            case "list_directory": {
                const parsed = ListDirectoryArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para list_directory: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                const entries = await fs.readdir(validPath, { withFileTypes: true });
                const formatted = entries
                    .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
                    .join("\n");
                return {
                    content: [{ type: "text", text: formatted }],
                };
            }

            case "directory_tree": {
                const parsed = DirectoryTreeArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para directory_tree: ${parsed.error}`);
                }

                interface TreeEntry {
                    name: string;
                    type: 'file' | 'directory';
                    children?: TreeEntry[];
                }

                async function buildTree(currentPath: string): Promise<TreeEntry[]> {
                    const validPath = await validatePath(currentPath);
                    const entries = await fs.readdir(validPath, { withFileTypes: true });
                    const result: TreeEntry[] = [];

                    for (const entry of entries) {
                        const entryData: TreeEntry = {
                            name: entry.name,
                            type: entry.isDirectory() ? 'directory' : 'file'
                        };

                        if (entry.isDirectory()) {
                            const subPath = path.join(currentPath, entry.name);
                            entryData.children = await buildTree(subPath);
                        }

                        result.push(entryData);
                    }

                    return result;
                }

                const treeData = await buildTree(parsed.data.path);
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(treeData, null, 2)
                    }],
                };
            }

            case "move_file": {
                const parsed = MoveFileArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para move_file: ${parsed.error}`);
                }
                const validSourcePath = await validatePath(parsed.data.source);
                const validDestPath = await validatePath(parsed.data.destination);
                await fs.rename(validSourcePath, validDestPath);
                return {
                    content: [{ type: "text", text: `Archivo movido exitosamente de ${parsed.data.source} a ${parsed.data.destination}` }],
                };
            }

            case "search_files": {
                const parsed = SearchFilesArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para search_files: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                const results = await searchFiles(validPath, parsed.data.pattern, parsed.data.excludePatterns);
                return {
                    content: [{ type: "text", text: results.length > 0 ? results.join("\n") : "No se encontraron coincidencias" }],
                };
            }

            case "get_file_info": {
                const parsed = GetFileInfoArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para get_file_info: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                const info = await getFileStats(validPath);
                return {
                    content: [{
                        type: "text", text: Object.entries(info)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join("\n")
                    }],
                };
            }

            case "copy_file": {
                const parsed = CopyFileArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para copy_file: ${parsed.error}`);
                }
                const validSourcePath = await validatePath(parsed.data.source);
                const validDestPath = await validatePath(parsed.data.destination);

                // Verificar si la fuente existe
                try {
                    await fs.access(validSourcePath);
                } catch (error) {
                    throw new Error(`El archivo de origen no existe o no es accesible: ${parsed.data.source}`);
                }

                // Verificar si el destino ya existe
                try {
                    await fs.access(validDestPath);
                    throw new Error(`El destino ya existe: ${parsed.data.destination}`);
                } catch (error) {
                    // Es bueno que no exista
                }

                // Verificar si la fuente es un directorio
                const stats = await fs.stat(validSourcePath);
                if (stats.isDirectory()) {
                    throw new Error(`La fuente es un directorio. Use copy_directory en su lugar: ${parsed.data.source}`);
                }

                // Copiar el archivo
                await fs.copyFile(validSourcePath, validDestPath);

                // Preservar metadatos
                await fs.utimes(validDestPath, stats.atime, stats.mtime);
                try {
                    await fs.chmod(validDestPath, stats.mode);
                } catch (error) {
                    console.error(`No se pudieron establecer los permisos para ${validDestPath}:`, error);
                }

                return {
                    content: [{ type: "text", text: `Archivo copiado exitosamente de ${parsed.data.source} a ${parsed.data.destination}` }],
                };
            }

            case "copy_directory": {
                const parsed = CopyDirectoryArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para copy_directory: ${parsed.error}`);
                }
                const validSourcePath = await validatePath(parsed.data.source);
                const validDestPath = await validatePath(parsed.data.destination);

                // Verificar si la fuente existe y es un directorio
                try {
                    const stats = await fs.stat(validSourcePath);
                    if (!stats.isDirectory()) {
                        throw new Error(`La fuente no es un directorio: ${parsed.data.source}`);
                    }
                } catch (error) {
                    throw new Error(`El directorio de origen no existe o no es accesible: ${parsed.data.source}`);
                }

                // Verificar si el destino ya existe
                try {
                    await fs.access(validDestPath);
                    throw new Error(`El destino ya existe: ${parsed.data.destination}`);
                } catch (error) {
                    // Es bueno que no exista
                }

                // Iniciar el proceso de copia recursiva
                await copyDir(validSourcePath, validDestPath, parsed.data.recursive);

                return {
                    content: [{ type: "text", text: `Directorio copiado exitosamente de ${parsed.data.source} a ${parsed.data.destination}` }],
                };
            }

            case "delete_file": {
                const parsed = DeleteFileArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Argumentos inválidos para delete_file: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);

                // Verificar si la ruta existe
                try {
                    await fs.access(validPath);
                } catch (error) {
                    throw new Error(`El archivo o directorio no existe o no es accesible: ${parsed.data.path}`);
                }

                // Verificar si es un directorio o archivo
                const stats = await fs.stat(validPath);
                if (stats.isDirectory()) {
                    if (parsed.data.force) {
                        // Eliminar directorio recursivamente si force=true
                        await fs.rm(validPath, { recursive: true, force: true });
                    } else {
                        // Verificar si el directorio está vacío
                        const entries = await fs.readdir(validPath);
                        if (entries.length > 0) {
                            throw new Error(`El directorio no está vacío. Use 'force: true' para eliminar: ${parsed.data.path}`);
                        }
                        // Eliminar directorio vacío
                        await fs.rmdir(validPath);
                    }
                } else {
                    // Eliminar archivo
                    await fs.unlink(validPath);
                }

                return {
                    content: [{ type: "text", text: `${stats.isDirectory() ? 'Directorio' : 'Archivo'} eliminado exitosamente: ${parsed.data.path}` }],
                };
            }

            case "list_allowed_directories": {
                return {
                    content: [{
                        type: "text",
                        text: `Directorios permitidos:\n${allowedDirectories.join('\n')}`
                    }],
                };
            }

            default:
                throw new Error(`Herramienta desconocida: ${name}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
            isError: true,
        };
    }
});

//Paso 8: Iniciar el servidor

// Iniciar servidor
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Servidor MCP de Sistema de Archivos Seguro ejecutándose en stdio");
    console.error("Directorios permitidos:", allowedDirectories);
    console.error("El servidor está listo para recibir comandos.");
  }
  
  runServer().catch((error) => {
    console.error("Error fatal al ejecutar el servidor:", error);
    process.exit(1);
  });