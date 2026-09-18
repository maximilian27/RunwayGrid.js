/**
 * Stylesheet for `<runway-grid>` shadow DOM.
 * Defines layout containment, flexbox container, scrolling tracks, and virtual spacer rules.
 *
 * @module styles
 */
export const RUNWAY_GRID_STYLES = `
  :host {
    display: block;
    position: relative;
    contain: strict;
    height: 100%;
    --runway-grid-scrollbar-size: 10px;
  }
  .runway-grid__container { display: flex; flex-direction: column; width: 100%; height: 100%; position: relative; }
  .runway-grid__row { display: flex; flex: 1; min-height: 0; min-width: 0; position: relative; }
  .runway-grid__viewport { flex: 1; min-width: 0; overflow: hidden; position: relative; outline: none; touch-action: none; }
  .runway-grid__wrapper { position: absolute; top: 0; left: 0; will-change: transform; }
  .runway-grid__rowgroup { position: absolute; top: 0; left: 0; }
  .runway-grid__cell { position: absolute; top: 0; left: 0; }
  .runway-grid__track--vertical { 
    flex-shrink: 0; 
    overflow-y: scroll; 
    overflow-x: hidden;
    scrollbar-width: thin;
    width: var(--runway-grid-scrollbar-size, 10px);
   }
  .runway-grid__spacer--vertical { width: 1px; will-change: height; }
  .runway-grid__track--horizontal {
    flex-shrink: 0;
    height: var(--runway-grid-scrollbar-size, 10px);
    overflow-x: scroll; 
    overflow-y: hidden; 
    scrollbar-width: thin;
  }
  .runway-grid__spacer--horizontal { height: 1px; will-change: width; }
  .runway-grid__track--disabled { display: none; }
`;
