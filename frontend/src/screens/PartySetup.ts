import type { Player } from '../contracts';
import { PLAYER_COLORS } from '../theme';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** DOM form for entering hero names (MVP step 1: "Create Characters"). */
export function askForParty(previous?: [Player, Player]): Promise<[Player, Player]> {
  const root = document.createElement('div');
  root.className = 'party';
  root.innerHTML = `
    <form autocomplete="off">
      <h2>Who Enters the Tale?</h2>
      <label><span><i style="background:${hex(PLAYER_COLORS[0])}"></i>Hero One</span><input name="p0" maxlength="14" placeholder="Rowan" /></label>
      <label><span><i style="background:${hex(PLAYER_COLORS[1])}"></i>Hero Two</span><input name="p1" maxlength="14" placeholder="Wren" /></label>
      <button type="submit">Begin the Adventure</button>
      <small>Hero One: A/D choose · W cast · 1/2/3 poses · S duck<br/>Hero Two: ←/→ choose · ↑ cast · I/O/P poses · ↓ duck</small>
    </form>`;
  document.body.appendChild(root);
  const form = root.querySelector('form')!;
  const inputs = [...form.querySelectorAll('input')];
  if (previous) inputs.forEach((el, i) => (el.value = previous[i].name));
  inputs[0].focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const party = inputs.map((el, i): Player => ({ index: i as 0 | 1, name: el.value.trim() || el.placeholder })) as [Player, Player];
      root.remove();
      resolve(party);
    });
  });
}
