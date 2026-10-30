# Deviations from the Figma

`SPEC.md` wins over the Figma. Where they differ, or the Figma doesn't cover a state:

- The **tab bar** and the **report-type radios** are always visible. In Inicial mode the bar shows only the Inicial tab; Comparativo adds the Final tab.
- No "| Free" label next to the user's name.
- Nombre, Apellidos, Fecha Inicial and the four injury fields stay editable for both report types. **Fecha Final** is the only disabled field, and only while **Reporte Inicial** is selected (it is not required or validated then). Comparativo requires every field, including the injuries. That template has no injury placeholders, so those four values are not written onto its closing page.
- The date-picker weekday letters are in Spanish (D L M M J V S, week starting on Sunday).
- The pencil icon from the Figma is omitted (it had no action in the spec).
- The **failure modal** is not in the Figma. It uses the same modal component as "Completado", with error texts from `strings.ts`.
- The drop zone reads "Arrastra aquí las fotos del paciente", the create button reads "Crear archivo", and the date picker confirms with "Aceptar". Each thumbnail has a manual "Usar foto original" / "Usar recorte" toggle. The default is the cutout. Nothing switches that choice on its own.
- "Subiendo Archivos" plays a small animated Yoda (`baby-yoda-waiting-small.webp`, 64px). The in-grid import tile still uses `loader.png`. "Creando Documento" plays `baby-yoda-waiting-modal.webp` at 120px.
