#!/usr/bin/env node

console.log(`
    Mi Servidor MCP del Sistema de Archivos
    ======================================
    
    Este servidor proporciona herramientas para interactuar de forma segura con el sistema de archivos.
    
    Uso:
      npm run start -- <directorio-permitido> [directorios-adicionales...]
    
    Herramientas disponibles:
      - read_file: Lee el contenido de un archivo
      - read_multiple_files: Lee el contenido de varios archivos a la vez
      - write_file: Crea o sobrescribe un archivo
      - edit_file: Edita el contenido de un archivo existente
      - create_directory: Crea un nuevo directorio
      - list_directory: Lista el contenido de un directorio
      - directory_tree: Muestra la estructura de directorios
      - move_file: Mueve o renombra archivos y directorios
      - search_files: Busca archivos por patrones
      - get_file_info: Obtiene información detallada de un archivo
      - copy_file: Copia un archivo de una ubicación a otra
      - copy_directory: Copia un directorio y su contenido
      - delete_file: Elimina un archivo o directorio
      - list_allowed_directories: Muestra los directorios permitidos
    
    Ejemplos:
      Para leer un archivo:
        { "name": "read_file", "arguments": { "path": "C:/ruta/al/archivo.txt" } }
    
      Para listar un directorio:
        { "name": "list_directory", "arguments": { "path": "C:/ruta/al/directorio" } }
    
      Para copiar un archivo:
        { "name": "copy_file", "arguments": { "source": "C:/origen.txt", "destination": "C:/destino.txt" } }
    `);