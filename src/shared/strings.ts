/**
 * Every user-visible Spanish string, in one place.
 *
 * Copy rule (Natalia): never add or remove words from copy the clinic already
 * approved; only the accents/spelling of a word may be corrected. Strings
 * marked "Figma" come from the Figma file (accents fixed only). The three
 * labels that were still in English are translated, with the drop-zone wording
 * the clinic asked for. Strings marked "app" cover states the Figma does not
 * draw — keep them short.
 */
export const S = {
  appTitle: 'DR·QUIRO Reportes', // app
  connectCanva: 'Conectar a Canva', // Figma
  connecting: 'Conectando…', // app
  disconnectCanva: 'Desconectar Canva', // Figma
  menu: 'Menú', // app (a11y)
  planSeparator: '|', // Figma ("Brian Pulgarin Vidal | Free")

  // Drop zone / tabs
  dropHere: 'Arrastra aquí las fotos del paciente',
  tabInicial: 'Inicial',
  tabFinal: 'Final',
  uploading: 'Subiendo Archivos',
  maxPhotos: 'Máximo 21 fotos', // Figma "Maximo" — accent fixed
  wrongFormatTitle: 'Formato Erróneo', // Figma "Formato Erroneo" — accent fixed
  wrongFormatBody: 'Solo se aceptan archivos PNG y JPG',
  missingAntes: 'Te faltó subir las fotos de “ANTES”', // Figma pattern, accent fixed
  missingDespues: 'Te faltó subir las fotos de “DESPUÉS”', // Figma "falto/DESPUES" — accents fixed
  removePhoto: 'Quitar foto', // app (tooltip / a11y)
  /** Shown while the photo is cut out. Clicking switches to the original frame. */
  useOriginal: 'Usar foto original', // app
  /** Shown while the original frame is selected. Clicking switches back to the cutout. */
  useCutout: 'Usar recorte', // app
  pickPhotos: 'Seleccionar fotos', // app (file dialog title)
  pickPhotosFilter: 'Archivos PNG y JPG', // app (file dialog filter)

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
  createFile: 'Crear archivo',
  requiredField: '*Este campo es requerido',
  requiredDate: '*Ingresar Fecha',

  // Date picker (Figma frame "Filled_Dropdate")
  pickerTitle: 'Selecciona una fecha',
  pickerClear: 'Limpiar',
  pickerCancel: 'Cancelar',
  pickerOk: 'Aceptar',
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
