/**
 * @jest-environment jsdom
 *
 * Campos que se capturan igual en el alta, la edición y el portal del QR
 * (js/colaboradores-campos.js): la rúbrica automática, el domicilio por partes
 * y las fechas DD/MM/AAAA.
 */

const campos = require('../js/colaboradores-campos');

describe('rúbrica a partir del nombre', () => {
  test('una inicial por palabra, como "Capturó" en Manifiestos', () => {
    expect(campos.rubricaDeNombre('Isaac Azhael López Cancino')).toBe('IALC');
    expect(campos.rubricaDeNombre('Pérez López Juan')).toBe('PLJ');
  });

  test('sin acentos y sin las partículas del apellido', () => {
    expect(campos.rubricaDeNombre('Ángel de la Rosa Úrsula')).toBe('ARU');
    expect(campos.rubricaDeNombre('María del Carmen Ortiz')).toBe('MCO');
  });

  test('hasta cinco letras y nada si no hay nombre', () => {
    expect(campos.rubricaDeNombre('Juan Carlos Pedro Luis Rosa Méndez')).toBe('JCPLR');
    expect(campos.rubricaDeNombre('   ')).toBe('');
  });
});

describe('rúbrica automática o manual en el formulario', () => {
  function montar(nombre, rubrica) {
    document.body.innerHTML = '<input id="n"><label for="r">Rúbrica</label><input id="r">';
    document.getElementById('n').value = nombre;
    document.getElementById('r').value = rubrica;
    return campos.conectarRubrica({ id: 'r', nombreId: 'n' });
  }
  const r = () => document.getElementById('r');
  const nota = () => document.querySelector('.cc-rub-nota').textContent;
  const escribir = (id, valor) => {
    document.getElementById(id).value = valor;
    document.getElementById(id).dispatchEvent(new Event('input'));
  };

  test('vacía se llena sola y lo dice', () => {
    montar('Pérez López Juan', '');
    expect(r().value).toBe('PLJ');
    expect(nota()).toContain('Automática');
  });

  test('sigue al nombre mientras nadie la cambie', () => {
    montar('', '');
    escribir('n', 'Ana Ruiz');
    expect(r().value).toBe('AR');
    escribir('n', 'Ana Ruiz Soto');
    expect(r().value).toBe('ARS');
  });

  test('una escrita a mano queda como manual y ya no se pisa', () => {
    montar('Pérez López Juan', '');
    escribir('r', 'jpl');
    expect(r().value).toBe('JPL');
    expect(nota()).toContain('Manual');

    escribir('n', 'Pérez López Juan Carlos');
    expect(r().value).toBe('JPL');
  });

  test('una guardada distinta de las iniciales se reconoce como manual', () => {
    montar('Pérez López Juan', 'JUANPL');
    expect(r().value).toBe('JUANPL');
    expect(nota()).toContain('Manual');
    expect(nota()).toContain('PLJ');
  });

  test('"Usar automática" la regresa a las iniciales', () => {
    montar('Pérez López Juan', 'XYZ');
    document.querySelector('.cc-rub-usar').click();
    expect(r().value).toBe('PLJ');
    expect(nota()).toContain('Automática');
  });
});

describe('domicilio por partes', () => {
  test('se compone en una sola línea que se puede volver a partir', () => {
    const partes = { calle: 'Av. Reforma', numero: '123 Int. 4', colonia: 'Centro', cp: '55600' };
    const texto = campos.componerDomicilio(partes);
    expect(texto).toBe('Av. Reforma No. 123 Int. 4, Col. Centro, C.P. 55600');
    expect(campos.partirDomicilio(texto)).toEqual(Object.assign({ libre: false, municipio: '', estado: '' }, partes));
  });

  test('no duplica los prefijos si los escriben', () => {
    expect(campos.componerDomicilio({ calle: 'Juárez', numero: 'No. 5', colonia: 'Col. Centro', cp: 'C.P. 55600' }))
      .toBe('Juárez No. 5, Col. Centro, C.P. 55600');
  });

  test('un domicilio viejo en una sola línea no se adivina: queda en calle', () => {
    const viejo = 'Calle 5 de Mayo 12, Tecámac, Edo. Méx.';
    expect(campos.partirDomicilio(viejo)).toEqual({ calle: viejo, numero: '', colonia: '', cp: '', municipio: '', estado: '', libre: true });
  });

  test('uno viejo que nadie separó se guarda igual que estaba', () => {
    const viejo = 'Calle 5 de Mayo 12, Tecámac, Edo. Méx.';
    expect(campos.componerDomicilio(campos.partirDomicilio(viejo))).toBe(viejo);
  });

  test('dice qué le falta', () => {
    expect(campos.faltantesDomicilio({ calle: 'Juárez', numero: '', colonia: 'Centro', cp: '556' }))
      .toEqual(['número', 'código postal de 5 dígitos']);
    expect(campos.faltantesDomicilio({ calle: 'a', numero: '1', colonia: 'b', cp: '55600' })).toEqual([]);
  });
});

describe('fechas DD/MM/AAAA', () => {
  test('pone las diagonales al teclear', () => {
    expect(campos.formatearFechaTecleada('15032024')).toBe('15/03/2024');
    expect(campos.formatearFechaTecleada('150')).toBe('15/0');
  });

  test('sólo valida fechas que existen', () => {
    expect(campos.fechaValida('29/02/2024')).toBe(true);
    expect(campos.fechaValida('29/02/2023')).toBe(false);
    expect(campos.fechaValida('2024-02-29')).toBe(false);
  });

  test('la máscara no toca un valor guardado con otro formato', () => {
    document.body.innerHTML = '<input id="f">';
    const input = campos.conectarFecha({ id: 'f' });
    input.value = 'SI';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('SI');
    input.value = '01022020';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('01/02/2020');
  });
});

describe('la fecha no deja teclear lo imposible', () => {
  const f = campos.formatearFechaTecleada;

  test('ni un día 32 ni un mes 13 o 25', () => {
    expect(f('32')).toBe('3');
    expect(f('3113')).toBe('31/1');
    expect(f('1225')).toBe('12/02');
  });

  test('un 4 al empezar el día, o un 2 al empezar el mes, se completan con cero', () => {
    expect(f('4')).toBe('04');
    expect(f('152')).toBe('15/02');
  });

  test('años entre 1900 y 2100', () => {
    expect(f('01011850')).toBe('01/01/1');
    expect(f('01011990')).toBe('01/01/1990');
  });

  test('con la fecha completa avisa si no existe', () => {
    document.body.innerHTML = '<div><input id="f"></div>';
    const input = campos.conectarFecha({ id: 'f' });
    input.value = '31022026';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('31/02/2026');
    expect(input.classList.contains('is-invalid')).toBe(true);
    input.value = '28022026';
    input.dispatchEvent(new Event('input'));
    expect(input.classList.contains('is-invalid')).toBe(false);
  });

  test('lo elegido en el calendario llega como DD/MM/AAAA', () => {
    document.body.innerHTML = '<div><input id="f"></div>';
    const input = campos.conectarFecha({ id: 'f' });
    const nativo = document.querySelector('.cc-fecha-nativo');
    expect(document.querySelector('.cc-fecha-btn')).not.toBeNull();
    nativo.value = '1990-05-20';
    nativo.dispatchEvent(new Event('change'));
    expect(input.value).toBe('20/05/1990');
  });
});

describe('Militar / Civil como combo', () => {
  function montar(valor) {
    document.body.innerHTML = '<div><label for="m">Militar / Civil</label><input id="m" class="form-control form-control-sm"></div>';
    document.getElementById('m').value = valor;
    return campos.conectarMilitar({ id: 'm' });
  }

  test('reconoce las variantes y no las reescribe hasta que alguien elige', () => {
    const { sel, input } = montar('MiliTar ');
    expect(sel.value).toBe('Militar');
    expect(input.value).toBe('MiliTar ');
    expect(input.classList.contains('d-none')).toBe(true);
    expect(document.querySelector('label').getAttribute('for')).toBe('m-sel');
  });

  test('al elegir escribe el valor limpio', () => {
    const { sel, input } = montar('');
    sel.value = 'Civil';
    sel.dispatchEvent(new Event('change'));
    expect(input.value).toBe('Civil');
  });

  test('un valor que no es ninguno de los dos se conserva', () => {
    const { sel } = montar('Marina');
    expect(sel.options[sel.selectedIndex].textContent).toBe('Marina');
  });
});

describe('Estado civil como combo', () => {
  function montar(valor) {
    document.body.innerHTML = '<div><label for="ec">Estado civil</label><input id="ec" class="form-control"></div>';
    document.getElementById('ec').value = valor;
    return campos.conectarEstadoCivil({ id: 'ec' });
  }

  test('trae la lista completa, con concubinato', () => {
    const { sel } = montar('');
    expect([...sel.options].slice(1).map(o => o.value)).toEqual([
      'Soltero(a)', 'Casado(a)', 'Concubinato', 'Unión libre', 'Sociedad de convivencia',
      'Separado(a)', 'Divorciado(a)', 'Viudo(a)',
    ]);
  });

  test('"SOLTERA" se muestra como Soltero(a) sin reescribirse, y no se pierde al guardar', () => {
    const { sel, input } = montar('SOLTERA');
    expect(sel.value).toBe('Soltero(a)');
    expect(input.value).toBe('SOLTERA');
  });

  test('al elegir escribe el valor del catálogo', () => {
    const { sel, input } = montar('');
    sel.value = 'Concubinato';
    sel.dispatchEvent(new Event('change'));
    expect(input.value).toBe('Concubinato');
  });

  test('un valor que no es estado civil se conserva', () => {
    const { sel } = montar('Comprometido');
    expect(sel.options[sel.selectedIndex].textContent).toBe('Comprometido');
  });
});

describe('las tres pantallas usan el mismo combo', () => {
  const fs = require('fs');
  const app = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const portal = fs.readFileSync(require('path').join(__dirname, '..', 'colaborador-registro.html'), 'utf8');

  test('ninguna trae una lista de estado civil fija en el HTML', () => {
    expect(app).not.toMatch(/<select[^>]*id="c[en]-estado-civil"/);
    expect(app).toContain("campos.conectarEstadoCivil({ id: p + '-estado-civil' })");
    expect(portal).toContain("conectarEstadoCivil({ id: 'f-estado-civil' })");
  });
});

describe('domicilio con municipio y estado, y desde el mapa', () => {
  test('municipio y estado van al final y se recuperan', () => {
    const partes = { calle: 'Calle Hidalgo', numero: '5', colonia: 'Centro', cp: '55740', municipio: 'Tecámac', estado: 'Estado de México' };
    const texto = campos.componerDomicilio(partes);
    expect(texto).toBe('Calle Hidalgo No. 5, Col. Centro, C.P. 55740, Tecámac, Estado de México');
    expect(campos.partirDomicilio(texto)).toEqual(Object.assign({ libre: false }, partes));
  });

  test('lo que da OpenStreetMap se acomoda en cada parte', () => {
    expect(campos.domicilioDeMapa({
      road: 'Calle Hidalgo', house_number: '5', neighbourhood: 'Colonia Centro',
      postcode: '55740', county: 'Tecámac', state: 'Estado de México', country: 'México',
    })).toEqual({ calle: 'Calle Hidalgo', numero: '5', colonia: 'Centro', cp: '55740', municipio: 'Tecámac', estado: 'Estado de México' });
  });

  test('sin número ni colonia en el mapa, quedan vacíos para capturarlos', () => {
    const p = campos.domicilioDeMapa({ road: 'Avenida Central', postcode: '55740-1', state: 'Estado de México' });
    expect(p.numero).toBe('');
    expect(p.colonia).toBe('');
    expect(p.cp).toBe('55740');
    expect(campos.faltantesDomicilio(p)).toEqual(['número', 'colonia']);
  });
});
