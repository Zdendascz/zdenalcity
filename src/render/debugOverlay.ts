/**
 * Ladicí výpis v rohu obrazovky. Vývojářský nástroj, ne herní UI — texty tady
 * schválně nejdou přes lokalizaci, protože je hráč nikdy neuvidí.
 */
export class DebugOverlay {
  private readonly element: HTMLElement;
  private visible = true;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'debug-overlay';
    parent.appendChild(this.element);
  }

  update(lines: readonly string[]): void {
    this.element.textContent = lines.join('\n');
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.classList.toggle('is-hidden', !visible);
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  destroy(): void {
    this.element.remove();
  }
}
