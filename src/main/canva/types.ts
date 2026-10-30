/**
 * Shapes of the Canva MCP editing responses we rely on. Only the fields the
 * app actually reads are typed; everything else passes through untouched
 * (the `pages` array in particular must be echoed back verbatim).
 */
export interface Position {
  top: number;
  left: number;
}
export interface Dimension {
  width: number;
  height: number;
}
export interface ContainerElement {
  type: string; // 'TEXT' | 'SHAPE' | 'RECT' | ...
  position: Position;
  dimension: Dimension;
}
export interface RichText {
  page_index: number;
  element_id: string;
  regions: { type?: string; text?: string }[];
  containerElement: ContainerElement;
}
export interface Fill {
  type?: string;
  asset_id?: string;
  page_index: number;
  element_id: string;
  editable?: boolean;
  containerElement?: ContainerElement;
}
export interface PageInfo {
  page_id: string;
  page_number?: number;
  is_responsive: boolean;
  dimension?: Dimension;
  [k: string]: unknown;
}
export interface EditingState {
  transaction_id: string;
  edit_design_url?: string;
  richtexts: RichText[];
  fills: Fill[];
  pages: PageInfo[];
}

export type EditOperation =
  | { type: 'find_and_replace_text'; element_id: string; find_text: string; replace_text: string }
  | { type: 'replace_text'; element_id: string; text: string }
  | {
      type: 'insert_fill';
      page_id: string;
      asset_type: 'image';
      asset_id: string;
      alt_text: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }
  | { type: 'update_title'; title: string };

/** One perform-editing-operations call (operations all start on `pageIndex`). */
export interface EditBatch {
  pageIndex: number;
  operations: EditOperation[];
}
