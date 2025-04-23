# mi-servidor-mcp-filesystem

Servidor MCP seguro para operaciones de sistema de archivos.

## Descripción

Este proyecto implementa un servidor MCP (“Model Context Protocol”) full-stack, capaz de buscar, copiar, mover, eliminar, editar y listar archivos y directorios de forma segura en los directorios permitidos. Incluye validaciones de seguridad, manejo robusto de errores y una arquitectura modular.

## Estructura del Proyecto

- `src/core/` — Lógica principal de la aplicación
- `src/utils/` — Utilidades y helpers compartidos
- `src/config/` — Configuración y banderas de features
- `src/index.ts` — Punto de entrada principal del servidor
- `src/help.ts` — Ayuda y comandos auxiliares
- `dist/` — Archivos compilados por TypeScript

## Scripts

- `npm run build` — Compila el proyecto TypeScript a JavaScript.
- `npm start` — Inicia el servidor principal.
- `npm run help` — Muestra la ayuda de comandos.

## Uso

```bash
npm install
npm run build
npm start -- <directorio-permitido> [directorio-adicional...]
```

Ejemplo:

```bash
npm start -- ./mi-directorio
```

## Seguridad

- Solo permite operaciones dentro de los directorios especificados al iniciar el servidor.
- Valida rutas y permisos antes de cualquier operación.

## Requisitos

- Node.js >= 18
- TypeScript

## Autor

Desarrollado por [Tu Nombre o Equipo].
