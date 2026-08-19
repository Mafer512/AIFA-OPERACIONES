// Minimal navigation delegator so we can later move logic out of script.js safely
;(function(){
  document.addEventListener('DOMContentLoaded', function(){
    // No-op: keep existing handlers from script.js. This file is a placeholder split point.
  });
})();

// Accordion behavior for top-level sidebar groups:
// When one group opens, all other top-level groups collapse automatically.
;(function(){
  var TOP_LEVEL_IDS = [
    'sg-operacion',
    'sg-sso', 'sg-ssa', 'sg-ssc', 'sg-si', 'sg-sge'
  ];

  document.addEventListener('DOMContentLoaded', function(){
    var nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    nav.addEventListener('show.bs.collapse', function(e){
      if (TOP_LEVEL_IDS.indexOf(e.target.id) === -1) return;
      TOP_LEVEL_IDS.forEach(function(id){
        if (id === e.target.id) return;
        var el = document.getElementById(id);
        if (el && el.classList.contains('show')) {
          var instance = bootstrap.Collapse.getInstance(el);
          if (instance) instance.hide();
        }
      });
    });
  });
})();

// ──────────────────────────────────────────────────────────────────────────
// NAV DECK — Lanzador de tarjetas
// Al hacer clic en un módulo: oculta el deck, muestra la sección y sube arriba.
// Botón flotante "Menú" para regresar al lanzador de tarjetas.
// ──────────────────────────────────────────────────────────────────────────
;(function(){
  document.addEventListener('DOMContentLoaded', function(){
    if (!document.body.classList.contains('navdeck-mode')) return;
    var deck = document.getElementById('sidebar');
    if (!deck) return;

    function scrollTop(){
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
    }
    function enterSection(){
      document.body.classList.add('navdeck-active');
      scrollTop();
    }
    // Volver al menu es SALIR del modulo, no taparlo.
    //
    // Antes esto quitaba solo la clase 'navdeck-active'. Por debajo, el modulo
    // que acababas de dejar seguia siendo la .content-section activa y el hash
    // seguia apuntando a el: la aplicacion creia que seguias dentro mientras tu
    // veias el lanzador. Cualquier cosa que volviera a poner 'navdeck-active'
    // -o que releyera el hash- te devolvia de golpe al modulo anterior, minutos
    // despues, sin haber tocado nada.
    //
    // exitSectionToMenu (script.js) apaga la seccion, olvida cual era y limpia
    // el hash. El respaldo de aqui hace lo mismo por si esto corre antes de que
    // script.js haya terminado de cargar.
    function showMenu(){
      document.body.classList.remove('navdeck-active');
      if (typeof window.exitSectionToMenu === 'function') {
        window.exitSectionToMenu();
      } else {
        document.querySelectorAll('.content-section.active')
          .forEach(function(sec){ sec.classList.remove('active'); });
        try {
          if (location.hash) history.replaceState(null, '', location.pathname + location.search);
        } catch (_) {}
      }
      scrollTop();
    }
    window._navdeckShowMenu = showMenu;
    window._navdeckEnterSection = enterSection;

    // Botón flotante para volver al menú de tarjetas
    var backBtn = document.createElement('button');
    backBtn.id = 'navdeck-back';
    backBtn.type = 'button';
    backBtn.className = 'navdeck-back-btn';
    backBtn.setAttribute('aria-label', 'Volver al menú principal');
    backBtn.innerHTML = '<i class="fas fa-grip"></i><span>Menú</span>';
    backBtn.addEventListener('click', showMenu);
    document.body.appendChild(backBtn);

    // Al hacer clic en cualquier enlace de navegación del deck → entrar a la sección
    deck.addEventListener('click', function(e){
      var a = e.target.closest('a.menu-item[data-section]');
      if (!a) return;
      // Dejar que showSection (handler global) corra primero, luego cambiar de vista
      setTimeout(enterSection, 0);
    });
  });
})();
