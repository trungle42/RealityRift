import type { PhoneInput } from './PhoneInput';
import { qrSvg } from './qr';

/**
 * What a tap on the phone does right now: whatever Enter or E would. The start screen starts, the result screen's button is
 * pressed, a vote takes the highlighted choice; otherwise Enter goes to whoever is listening (dialogue, Willow's briefing and
 * quest card, the scanner: they all take Enter and mark it handled), and if nobody took it the hero interacts, like E.
 */
export function phoneAction(interact: () => void): void {
  const start = document.querySelector<HTMLFormElement>('.adventure-start form');
  if (start) { start.requestSubmit(); return; }
  const again = document.querySelector<HTMLButtonElement>('.run-result button');
  if (again) { again.click(); return; }
  const choice = document.querySelector<HTMLButtonElement>('dialog[open] button');
  if (choice) { (document.activeElement instanceof HTMLButtonElement && document.activeElement.closest('dialog[open]') ? document.activeElement : choice).click(); return; }
  if (press('Enter')) return;
  interact();
}

/** A key press as the keyboard would send it; true if a listener handled it (prevented its default). */
function press(code: string): boolean {
  const down = new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true });
  window.dispatchEvent(down);
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
  return down.defaultPrevented;
}

/**
 * The start screen's phone corner: a QR code of the phone joystick page and whether a phone has joined, so a player connects
 * and starts (one tap on the phone) without touching the keyboard. It goes away with the start screen.
 */
export function showPhonePairing(phone: PhoneInput): void {
  const overlay = document.querySelector<HTMLElement>('.adventure-start');
  if (!overlay) return;
  const card = document.createElement('aside'); card.className = 'start-phone';
  Object.assign(card.style, {
    position: 'absolute', right: '24px', bottom: '24px', width: '208px', padding: '14px', borderRadius: '8px', zIndex: '2', textAlign: 'center',
    background: 'var(--game-panel, #19372ff2)', border: '1px solid var(--game-line, #c5d3bd55)', color: 'var(--game-text, #faf5e1)', font: '13px Georgia, serif',
  });
  card.innerHTML = '<div class="start-phone-qr" style="width:180px;height:180px;margin:0 auto 10px;background:#fff;border-radius:4px"></div>'
    + '<strong class="start-phone-status" style="display:block;color:var(--game-gold,#f0d48e);font-size:15px"></strong><span class="start-phone-hint" style="display:block;margin-top:4px;opacity:.85;word-break:break-all"></span>';
  overlay.append(card);
  const qr = card.querySelector<HTMLElement>('.start-phone-qr')!, status = card.querySelector<HTMLElement>('.start-phone-status')!, hint = card.querySelector<HTMLElement>('.start-phone-hint')!;
  let url = '';
  void phone.phoneUrl().then((link) => { url = link; try { qr.innerHTML = qrSvg(link); } catch { qr.textContent = link; } });
  const show = () => {
    const players = phone.players();
    status.textContent = players.length > 1 ? `${players.length} phones connected` : phone.phoneConnected ? 'Phone connected' : 'Scan with your phone';
    hint.textContent = phone.phoneConnected ? `Player 1: tap your phone to begin${players.length < 3 ? ' · others: scan to join' : ''}` : url || 'to use it as your controller';
  };
  show();
  const timer = window.setInterval(() => { if (!card.isConnected) { clearInterval(timer); return; } show(); }, 250);
}
