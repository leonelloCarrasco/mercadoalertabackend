-- Tour guiado de bienvenida (primer login) — NULL significa que el usuario
-- todavía no lo vio (o no lo terminó/cerró ni una vez). Se marca la primera
-- vez que el tour se cierra, sea porque llegó al final o porque el usuario
-- lo cerró antes (con la X, click afuera del modal, o el botón "Saltar") —
-- en cualquiera de los casos no se le vuelve a mostrar solo; el usuario
-- puede volver a verlo manualmente desde Ayuda sin que esto se toque de
-- nuevo (ver POST /api/auth/me/tutorial-completado en auth.routes.js).
ALTER TABLE users ADD COLUMN tutorial_completado_at TIMESTAMP;
