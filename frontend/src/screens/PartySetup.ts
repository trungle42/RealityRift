import type { Player } from '../contracts';

/** DOM form for entering hero names (MVP step 1: "Create Characters"). */
export function askForParty(previous?: [Player, Player]): Promise<[Player, Player]> {
  const root = document.createElement('div');
  root.className = 'party';
  root.innerHTML = `
    <form autocomplete="off">
      <div class="eyebrow">Every legend begins with a name</div>
      <h2>Who enters the tale?</h2>
      <p class="party-intro">Two souls, bound by a little courage and a little magic.</p>
      <div class="hero-fields">
        <div class="hero-field"><img class="hero-portrait" src="${import.meta.env.BASE_URL}art/ranger-idle.webp" alt="Emerald-cloaked ranger" /><span class="hero-role">The woodland guardian</span><label for="hero-one">HERO ONE</label><input id="hero-one" name="p0" maxlength="14" placeholder="Rowan" /></div>
        <div class="hero-field"><img class="hero-portrait" src="${import.meta.env.BASE_URL}art/mage-idle.webp" alt="Armored spellblade in an ivory and crimson cloak" /><span class="hero-role">The dawn spellweaver</span><label for="hero-two">HERO TWO</label><input id="hero-two" name="p1" maxlength="14" placeholder="Wren" /></div>
      </div>
      <button class="primary-button" type="submit">Enter the enchanted realm <span aria-hidden="true">↗</span></button>
      <small>One keyboard. Two heroes. Three shared hearts.<br/>Open Controls at any time for your spellbook of moves.</small>
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
