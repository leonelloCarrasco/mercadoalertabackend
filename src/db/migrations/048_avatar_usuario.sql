-- Avatar de perfil — se guarda como data-URI base64 completo
-- (data:image/jpeg;base64,...) directamente en la base de datos, NO en
-- disco ni en un bucket externo. Decisión deliberada: el proyecto no tiene
-- hoy ninguna integración de almacenamiento persistente de archivos (S3,
-- Cloudinary, etc.) y escribir a disco local es riesgoso en la mayoría de
-- hostings de Node por defecto (filesystem efímero, se pierde en cada
-- redeploy). Guardarlo como TEXT es la opción más simple y confiable dado
-- lo que ya existe — el límite de tamaño (ver auth.routes.js, 1MB antes de
-- codificar) evita que esto infle demasiado la tabla.
ALTER TABLE users ADD COLUMN avatar_data TEXT;
