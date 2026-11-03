# Instalar DR·QUIRO Reportes en Mac

Descargue el disco que corresponde a su Mac:

- Mac con Apple Silicon (M1, M2, M3, M4…): `DR-QUIRO-Reportes-<versión>-arm64.dmg`
- Mac con Intel: `DR-QUIRO-Reportes-<versión>-x64.dmg`

En el menú Apple → **Acerca de este Mac**: si dice «Chip» de Apple, es Apple Silicon. Si dice «Procesador» Intel, es Intel.

La aplicación no está notarizada. No hay cuenta de desarrollador de Apple. La primera vez hay que abrirla a mano.

## 1. Abrir el disco

Abra el archivo `.dmg`. Se abre una ventana con el icono de **DR·QUIRO Reportes** y un acceso a **Aplicaciones**.

## 2. Arrastrar a Aplicaciones

Arrastre **DR·QUIRO Reportes** a la carpeta **Aplicaciones**.

## 3. Abrirla la primera vez

El doble clic puede bloquearla porque Apple no la notarizó.

1. En **Aplicaciones**, haga clic derecho (o Control + clic) sobre **DR·QUIRO Reportes** → **Abrir**. En el aviso, pulse **Abrir**.
2. Si no aparece esa opción: **Ajustes del Sistema** → **Privacidad y seguridad** → **Abrir de todas formas**.

Si macOS dice que la aplicación está dañada, abra **Terminal** y ejecute:

```bash
xattr -dr com.apple.quarantine "/Applications/DR·QUIRO Reportes.app"
```

Después ábrala de nuevo.

## Canva

Pulse **Conectar a Canva**. Se abre el navegador. Al aceptar, el inicio de sesión vuelve a la aplicación por sí solo (igual que en Windows). Si macOS pregunta si quiere aceptar conexiones entrantes, pulse **Permitir**: es ese regreso, solo en este equipo.
