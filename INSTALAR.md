# Instalar DR·QUIRO Reportes

## Windows

Hay dos opciones; use la que prefiera:

- **Instalador:** `DR-QUIRO-Reportes-Setup-x.y.z.exe`. Se instala solo para su usuario (no pide permisos de administrador) y crea accesos directos en el Escritorio y en el menú Inicio. Si ya tiene una versión instalada, ejecute el Setup nuevo: actualiza esa instalación en la misma carpeta y conserva los datos. No hace falta desinstalar.
- **Portable:** `DR-QUIRO-Reportes-Portable-x.y.z.exe`. No se instala: haga doble clic y la aplicación se abre. Puede guardarlo en cualquier carpeta o en una memoria USB. Para actualizarlo, cierre la aplicación y reemplace el archivo.

La aplicación no está firmada digitalmente, por eso Windows puede mostrar el aviso **"Windows protegió su PC"** (SmartScreen):

1. Haga clic en **Más información**.
2. Haga clic en **Ejecutar de todos modos**.

Esto solo ocurre la primera vez.

## macOS

Descargue el archivo `.dmg` que corresponde a su Mac:

- Mac con Apple Silicon (M1, M2, M3, M4…): `DR-QUIRO-Reportes-x.y.z-arm64.dmg`
- Mac con Intel: `DR-QUIRO-Reportes-x.y.z-x64.dmg`

(Menú  → *Acerca de este Mac*: si dice "Chip Apple", es Apple Silicon; si dice "Procesador Intel", es Intel).

1. Abra el `.dmg` y arrastre **DR·QUIRO Reportes** a la carpeta **Aplicaciones**.
2. La aplicación **no está firmada ni notarizada por Apple**, por eso la primera vez macOS no la deja abrir con doble clic. En su lugar:
   - En **Aplicaciones**, haga **clic derecho** (o Control + clic) sobre la aplicación → **Abrir** → en el aviso, **Abrir**.
   - En macOS 15 o más reciente, si no aparece el botón: abra *Ajustes del Sistema → Privacidad y seguridad*, baje hasta el mensaje sobre DR·QUIRO Reportes y pulse **Abrir igualmente**.
3. Si macOS dice que la aplicación "está dañada", abra la aplicación **Terminal** y ejecute:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/DR·QUIRO Reportes.app"
   ```

   Después ábrala normalmente.

## Primer uso

1. Abra la aplicación y pulse **Conectar Canva**. Se abrirá su navegador para iniciar sesión en Canva y aceptar los permisos. Al terminar, vuelva a la aplicación.
2. La sesión queda guardada de forma cifrada en este equipo. Para cerrarla, use el menú (☰) → **Desconectar Canva**.

Las fotos se procesan en el propio equipo (el fondo se quita sin enviar las fotos a ningún servicio externo); solo las imágenes ya recortadas se suben a su cuenta de Canva.
