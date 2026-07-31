/* Tira a "cara de navegador" do app (janela Edge --app):
 * o Edge mostra uma barrinha com a URL no canto quando o mouse passa sobre
 * um <a href>. Isso denuncia que é um navegador. Aqui a gente remove o href
 * de todos os links (é o href que dispara a barrinha), guarda o destino em
 * data-href e navega via JavaScript no clique — mesmo comportamento, sem a
 * barrinha. Um MutationObserver cobre links criados/atualizados depois
 * (banners, promoções, etc.). */
(function () {
  'use strict';

  function harden(a) {
    var h = a.getAttribute('href');
    if (h === null) return;            // já tratado
    a.setAttribute('data-href', h);
    a.removeAttribute('href');
    if (!a.style.cursor) a.style.cursor = 'pointer';
  }

  function sweep(root) {
    var list = (root || document).querySelectorAll('a[href]');
    for (var i = 0; i < list.length; i++) harden(list[i]);
  }

  // Navega no clique. Respeita quem já tratou o clique (ex.: cards que abrem
  // aba via postMessage chamam preventDefault) — nesse caso não fazemos nada.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || e.defaultPrevented) return;
    var u = a.getAttribute('data-href');
    if (!u || u === '#') return;
    e.preventDefault();
    if (a.target === '_blank' || /^(https?:|mailto:|tel:)/i.test(u)) {
      window.open(u, '_blank', 'noopener');
    } else {
      window.location.assign(u);
    }
  });

  sweep();
  document.addEventListener('DOMContentLoaded', function () { sweep(); });

  // Links adicionados ou com href setado por JS depois do load.
  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'attributes') {
          if (m.target.tagName === 'A' && m.target.hasAttribute('href')) harden(m.target);
        } else if (m.addedNodes) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'A') harden(n);
            if (n.querySelectorAll) sweep(n);
          }
        }
      }
    }).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['href']
    });
  } catch (_) { /* MutationObserver sempre existe no Edge; guard por segurança */ }
})();
