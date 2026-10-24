import type { Narrator } from '../audio/Narrator';
import { setPaused } from '../core/clock';

export function setupGameTools(narrator: Narrator): void {
  const tools = document.createElement('nav');
  tools.className = 'game-tools';
  tools.setAttribute('aria-label', 'Game settings');
  tools.innerHTML = '<button type="button" class="voice-toggle">Voice · on</button><button type="button" class="controls-toggle">Controls ?</button>';
  const dialog = document.createElement('dialog');
  dialog.className = 'controls-dialog';
  dialog.setAttribute('aria-labelledby', 'controls-title');
  dialog.innerHTML = `<h2 id="controls-title">Your magic, your moves</h2>
    <p>Play together on one keyboard. Your team shares three hearts; each hero earns their own stars. The adventure pauses while this guide is open.</p>
    <table><thead><tr><th>Action</th><th>Hero One</th><th>Hero Two</th></tr></thead><tbody>
    <tr><td>Choose a path</td><td>A / D</td><td>← / →</td></tr><tr><td>Cast a spell</td><td>W</td><td>↑</td></tr>
    <tr><td>Raise your arms</td><td>1</td><td>I</td></tr><tr><td>T-pose</td><td>2</td><td>O</td></tr>
    <tr><td>Crouch / dodge</td><td>3 or S</td><td>P or ↓</td></tr></tbody></table>
    <p><strong>Freeze:</strong> release your keys and stay still.<br><strong>Story:</strong> Space or Enter reveals the text, then continues.<br><strong>Boss:</strong> dodge the attack, then cast when its ward falls.<br><strong>Voice:</strong> press M to toggle spoken narration.</p>
    <button type="button" class="primary-button">Return to the tale <span aria-hidden="true">↗</span></button>`;
  document.body.append(tools, dialog);
  const voice = tools.querySelector<HTMLButtonElement>('.voice-toggle')!;
  const sync = () => { voice.textContent = `Voice · ${narrator.enabled ? 'on' : 'off'}`; voice.setAttribute('aria-pressed', String(narrator.enabled)); };
  sync();
  voice.addEventListener('click', () => { narrator.toggle(); sync(); });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    narrator.toggle(); sync();
  });
  tools.querySelector('.controls-toggle')!.addEventListener('click', () => { setPaused(true); narrator.stop(); dialog.showModal(); });
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => setPaused(false));
}
