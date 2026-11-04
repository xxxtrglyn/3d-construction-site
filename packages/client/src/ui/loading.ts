/** Controls the inline HTML loading screen from index.html. */
export class Loading {
  private readonly root = document.getElementById('loader');
  private readonly fill = document.getElementById('loader-fill');
  private readonly msg = document.getElementById('loader-msg');

  progress(fraction: number): void {
    if (this.fill) this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  }

  message(text: string): void {
    if (this.msg) this.msg.textContent = text;
  }

  done(): void {
    this.progress(1);
    this.root?.classList.add('hidden');
    window.setTimeout(() => this.root?.remove(), 600);
  }

  fail(text: string): void {
    if (this.root) {
      this.root.classList.remove('hidden');
      const bar = this.root.querySelector('.bar') as HTMLElement | null;
      if (bar) bar.style.display = 'none';
    }
    this.message(text);
  }
}
