/**
 * Shadow DOM template definition for `<runway-grid>`.
 *
 * @module template
 */
import { RUNWAY_GRID_STYLES } from './styles.js';

/**
 * Static HTML template parsed once by the browser for faster instantiation.
 * @type {HTMLTemplateElement}
 */
export const COMPONENT_TEMPLATE = document.createElement('template');
COMPONENT_TEMPLATE.innerHTML = `
  <style>${RUNWAY_GRID_STYLES}</style>
  <div class="runway-grid__container" part="container">
      <div class="runway-grid__row" part="row">
          <div class="runway-grid__viewport" part="viewport" tabindex="0">
              <div class="runway-grid__wrapper" part="wrapper"></div>
          </div>
          <div class="runway-grid__track runway-grid__track--vertical" part="track track-vertical">
              <div class="runway-grid__spacer runway-grid__spacer--vertical" part="spacer spacer-vertical"></div>
          </div>
      </div>
      <div class="runway-grid__bottom-bar" part="bottom-bar">
          <div class="runway-grid__track runway-grid__track--horizontal" part="track track-horizontal">
              <div class="runway-grid__spacer runway-grid__spacer--horizontal" part="spacer spacer-horizontal"></div>
          </div>
          <div class="runway-grid__corner" part="corner"></div>
      </div>
  </div>
`;
