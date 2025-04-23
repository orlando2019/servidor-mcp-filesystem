# MCP-SERVER: Servidor MCP para Sistema de Archivos

Este proyecto implementa un servidor MCP (Model Context Protocol) que permite realizar operaciones seguras en el sistema de archivos. Ofrece funcionalidades completas para manipular archivos y directorios, con un fuerte énfasis en la seguridad.

## Características

- **Operaciones completas de archivos**: Leer, escribir, copiar, mover, eliminar
- **Gestión de directorios**: Listar, crear, copiar, eliminar
- **Búsqueda avanzada**: Buscar archivos por patrones con exclusiones
- **Visualización estructurada**: Árbol de directorios en formato JSON
- **Edición de archivos**: Realizar modificaciones específicas con detección de cambios
- **Seguridad robusta**: Validación estricta de rutas, prevención de path traversal, manejo seguro de symlinks

## Requisitos previos

- Node.js (versión 16 o superior)
- npm o yarn

## Instalación

1. Clona este repositorio:
```bash
git clone https://github.com/tu-usuario/mcp-server.git
cd mcp-server
```

2. Instala las dependencias:
```bash
npm install
```

3. Compila el código:
```bash
npm run build
```

## Uso

### Ejecución manual

```bash
node dist/index.js <directorio-permitido> [directorios-adicionales...]
```

Ejemplo:
```bash
node dist/index.js C:/Users/Orlando/Documentos
```

### Integración con clientes MCP

Para integrar con aplicaciones como Claude Desktop, modifica el archivo `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "node",
      "args": [
        "C:/ruta/al/proyecto/dist/index.js",
        "C:/ruta/al/directorio/permitido"
      ]
    }
  }
}
```

## Herramientas disponibles

| Herramienta | Descripción |
|-------------|-------------|
| `read_file` | Lee el contenido de un archivo |
| `write_file` | Crea o sobrescribe un archivo |
| `edit_file` | Edita partes específicas de un archivo |
| `list_directory` | Lista archivos y directorios |
| `directory_tree` | Muestra estructura de directorios en JSON |
| `copy_file` | Copia un archivo preservando metadatos |
| `copy_directory` | Copia un directorio completo |
| `move_file` | Mueve o renombra archivos/directorios |
| `delete_file` | Elimina un archivo o directorio |
| `search_files` | Busca archivos por patrones |
| `get_file_info` | Obtiene metadatos de archivos |
| `create_directory` | Crea directorios recursivamente |
| `list_allowed_directories` | Muestra directorios permitidos |

## Ejemplos de uso

### Leer un archivo
```json
{
  "name": "read_file",
  "arguments": {
    "path": "C:/Users/Orlando/Documentos/archivo.txt"
  }
}
```

### Copiar un directorio
```json
{
  "name": "copy_directory",
  "arguments": {
    "source": "C:/Users/Orlando/Documentos/carpeta",
    "destination": "C:/Users/Orlando/Documentos/carpeta-copia"
  }
}
```

### Buscar archivos
```json
{
  "name": "search_files",
  "arguments": {
    "path": "C:/Users/Orlando/Documentos",
    "pattern": "informe"
  }
}
```

## Pruebas

Para probar el servidor, puedes usar el MCP Inspector:

```bash
npm install -g @modelcontextprotocol/inspector
mcp-inspector
```

En el inspector, conecta usando:
- Command: `node`
- Arguments: `["ruta/al/dist/index.js", "ruta/al/directorio/prueba"]`

## Seguridad

Este servidor implementa múltiples capas de seguridad:

- Validación de rutas para prevenir acceso a directorios no permitidos
- Normalización de rutas para evitar ataques de "path traversal"
- Verificación de enlaces simbólicos para evitar redirecciones maliciosas
- Validación de argumentos antes de ejecutar cualquier operación

## Estructura del proyecto

```
MCP-SERVER/
├── dist/               # Código compilado
├── src/                # Código fuente
│   └── index.ts        # Archivo principal
├── package.json        # Dependencias y scripts
├── tsconfig.json       # Configuración de TypeScript
└── README.md           # Este archivo
```

## Créditos

Este proyecto fue desarrollado como parte de un proyecto de aprendizaje sobre el Model Context Protocol (MCP).

## Licencia

Este proyecto está licenciado bajo MIT License.
