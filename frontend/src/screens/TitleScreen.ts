import type { Container } from 'pixi.js';
import type { InputSource } from '../contracts';

/** Native, keyboard-accessible menu over the animated forest. */
export async function showTitle(_parent: Container, input: InputSource): Promise<void> {
  const screen = document.createElement('section');
  screen.className = 'title-screen';
  screen.setAttribute('aria-label', 'Storybound main menu');
  screen.innerHTML = `
    <div class="title-wordmark"><span class="small-diamond">✧</span> STORYBOUND <span class="wordmark-line"></span></div>
    <div class="title-content">
      <div class="eyebrow">A tale waiting to be told</div>
      <h1>Reality<span>Rift</span></h1>
      <div class="title-rule"><span></span>◇<span></span></div>
      <p class="title-tagline">The world is enchanted.<br>The story is yours.</p>
      <p class="title-description">Explore enchanted lands. Discover forgotten treasures.<br>Two heroes. One adventure of your own.</p>
      <button class="primary-button begin-button" type="button"><span>Begin your adventure</span><span aria-hidden="true">↗</span></button>
      <div class="title-keyhint"><kbd>Space</kbd> or <kbd>Enter</kbd> to begin</div>
    </div>
    <div class="title-footer"><span>AN INTERACTIVE FAIRY TALE</span><span>02 HEROES <i>·</i> 01 SHARED DESTINY</span></div>
    <div class="location-tag"><span class="location-dot"></span> THE EVERGREEN SANCTUARY</div>`;
  document.body.appendChild(screen);
  await new Promise<void>((resolve) => {
    const button = screen.querySelector<HTMLButtonElement>('.begin-button')!;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      off();
      button.removeEventListener('click', finish);
      screen.classList.add('leaving');
      window.setTimeout(() => { screen.remove(); resolve(); }, 400);
    };
    const off = input.subscribe((e) => { if (e.kind === 'confirm') finish(); });
    button.addEventListener('click', finish);
  });
}
