/**
 * Every user-visible Spanish string, in one place.
 *
 * Copy rule (Natalia): never add or remove words from provided copy; only the
 * accents/spelling of a word may be corrected. Strings marked "Figma" come
 * verbatim from the Figma file (accents fixed only). Strings marked "app" are
 * needed by states the Figma does not draw (failure modal, etc.) — keep them short.
 */
export const S = {
  appTitle: 'DR·QUIRO Reportes', // app
  connectCanva: 'Conectar a Canva', // Figma
  connecting: 'Conectando…', // app
  disconnectCanva: 'Desconectar Canva', // Figma
  planSeparator: '|', // Figma ("Brian Pulgarin Vidal | Free")

  // Drop zone / tabs (Figma)
  dropHere: 'Drop Patient Photos Here', // Figma (kept verbatim: copy rule forbids rewording)
  tabInicial: 'Inicial',
  tabFinal: 'Final',
  uploading: 'Subiendo Archivos',
  maxPhotos: 'Máximo 21 fotos', // Figma "Maximo" — accent fixed
  wrongFormatTitle: 'Formato Erróneo', // Figma "Formato Erroneo" — accent fixed
  wrongFormatBody: 'Solo se aceptan archivos PNG y JPG',
  missingAntes: 'Te faltó subir las fotos de “ANTES”', // Figma pattern, accent fixed
  missingDespues: 'Te faltó subir las fotos de “DESPUÉS”', // Figma "falto/DESPUES" — accents fixed
  removePhoto: 'Quitar foto', // app (tooltip / a11y)
  cutoutUnreliable: 'El recorte de esta foto no es fiable. Se usará la foto original.',
  cutoutBadge: 'No fiable',
  useOriginal: 'Usar foto original',
  useCutout: 'Usar recorte',

  // Form (Figma)
  nombre: 'Nombre',
  apellidos: 'Apellidos',
  fechaInicial: 'Fecha Inicial',
  fechaFinal: 'Fecha Final',
  injuryPlaceholder: 'Insertar Lesión',
  injuries: {
    tension: 'Tensión del tejido',
    tendon: 'Lesión del tendón',
    ligamento: 'Lesión del ligamento',
    otras: 'Otras Lesiones',
  },
  reporteInicial: 'Reporte Inicial',
  reporteComparativo: 'Reporte Comparativo',
  createFile: 'Create File', // Figma (kept verbatim: copy rule forbids rewording)
  requiredField: '*Este campo es requerido',
  requiredDate: '*Ingresar Fecha',

  // Date picker (Figma frame "Filled_Dropdate")
  pickerTitle: 'Selecciona una fecha',
  pickerClear: 'Limpiar',
  pickerCancel: 'Cancelar',
  pickerOk: 'OK',
  prevMonth: 'Mes anterior', // app (a11y)
  nextMonth: 'Mes siguiente', // app (a11y)

  // Progress modals (Figma)
  creatingDocument: 'Creando Documento',
  completed: 'Completado',
  reviewDocument: 'Revisar documento',

  // Failure modal (app — not drawn in Figma)
  errorTitle: 'No se pudo crear el documento',
  retry: 'Reintentar',
  close: 'Cerrar',
  errors: {
    notConnected: 'Primero conecta tu cuenta de Canva.',
    loginCancelled: 'No se completó el inicio de sesión en Canva.',
    network: 'No hay conexión con Canva. Revisa tu internet e inténtalo de nuevo.',
    canva: 'Canva rechazó la operación. Inténtalo de nuevo en unos minutos.',
    template: 'La plantilla de Canva no tiene la estructura esperada.',
    photo: 'No se pudo procesar una de las fotos.',
    model: 'No se encontró el modelo para quitar el fondo. Reinstala la aplicación.',
    unknown: 'Ocurrió un error inesperado.',
  },
} as const;

/** Spanish month names, capitalised as used in reports ("Julio 08, 2026"). */
export const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;
export const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const;
/** Week starts on Sunday, like the Figma picker. */
export const WEEKDAYS_NARROW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'] as const;
export const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
