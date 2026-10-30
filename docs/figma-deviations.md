# Deviations from the Figma

`SPEC.md` wins over the Figma. Where they differ, or the Figma doesn't cover a state:

- The **tab bar** and the **report-type radios** are always visible. In Inicial mode the bar shows only the Inicial tab; Comparativo adds the Final tab.
- No "| Free" label next to the user's name.
- In **Comparativo**, the injury fields are disabled, because the Comparativo template has no injury page.
- The date-picker weekday letters are in Spanish (D L M M J V S, week starting on Sunday).
- The pencil icon from the Figma is omitted (it had no action in the spec).
- The **failure modal** is not in the Figma. It uses the same modal component as "Completado", with error texts from `strings.ts`.
- The loader image is a swappable asset: `src/renderer/assets/loader.png`.
