// Página "Baixar o app": destaca o sistema de quem está vendo e ajuda no iPhone.
const ua = navigator.userAgent;
const $ = (id) => document.getElementById(id);
const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
if (/TavernaApp/.test(ua) || window.tavernaApp || standalone) $('inApp').classList.remove('hidden');
if (ios) $('cardIos').classList.add('mine');
else if (/Android/i.test(ua)) $('cardAndroid').classList.add('mine');
else if (/Windows/i.test(ua)) $('cardWin').classList.add('mine');

function note(msg) { $('iosNote').textContent = msg; $('iosNote').classList.remove('hidden'); }
$('dlIos').addEventListener('click', () => {
  if (!ios) {
    note('Abra este site no iPhone ou iPad para instalar. Dica: aponte a câmera para o QR code de uma sala ou digite tavernanacombie.win no Safari.');
    return;
  }
  if (standalone) { note('O app já está instalado. Abra pelo ícone da Kombi na tela de início.'); return; }
  if (/CriOS|FxiOS|EdgiOS/.test(ua)) note('No Chrome/Firefox do iPhone também dá: toque em Compartilhar e depois em Adicionar à Tela de Início. Se não aparecer, abra no Safari.');
  else note('Agora toque em Compartilhar na barra do Safari e escolha "Adicionar à Tela de Início".');
});
