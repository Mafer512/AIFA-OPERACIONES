/* ==========================================================================
   Conciliación › saldos oficiales de los oficios a la Subsecretaría
   --------------------------------------------------------------------------
   Los acumulados del oficio (mes, año y desde el inicio de operaciones del
   AIFA) son sumas corridas: el del día anterior más el dato del día. La base
   de manifiestos no tiene todo lo que esas sumas ya traen —pasajeros de enero
   a julio de 2026 y los años 2022 a 2025— y hay días cuyo dato se envió antes
   de una corrección del libro. Por eso:

   · SALDOS: los acumulados parten de un oficio enviado, tal cual se envió.
     Cada fecha usa el saldo más reciente a esa fecha (antes del primero, el
     primero); los reportes de Subsecretaría y el mensaje del SWEAR le suman
     (o restan) los datos diarios que calcula la aplicación.
       30/09/2026        cierre de septiembre.
       01 a 19/10/2026   cada oficio de octubre tal como se envió, también el
                         dato del día: el libro corrigió el mes a mano (quitó
                         los vuelos de septiembre cerrados en octubre: la carga
                         el 05/10, los pasajeros el 12/10) y varios días
                         cambiaron después de enviarse. Así el mensaje de esos
                         días sale igual al enviado, y uno nuevo parte del
                         último oficio enviado.
   · ENVIADOS: los días cuyo libro cambió después de enviar el oficio llevan
     el dato enviado (el 01 y 02/10, de antes de registrar cada oficio).

   Fuentes:
     Pasajeros: "REPORTE GENERAL OCTUBRE 2026", hoja SUBSECRETARÍA, bloques
                30/09 al 18/10; el 19/10, el mensaje enviado (el libro trae
                1 pasajero internacional más).
     Carga:     "BASE DE CARGA 2026" (rep2), hoja Subsecretaría, bloque 30/09;
                "CARGA OCT 2026", hoja Subsecretaría, bloques 01 al 19/10.

   Comprobado: saldo + datos del 01 al 06/10 = oficio del 06/10/2026
   (5,759,386 pax / 43,102 ops; 320,156 t / 12,119 ops), y los mensajes
   enviados del 04, 07, 15, 17, 18 y 19/10/2026 = los que arma la aplicación.
   ========================================================================== */
(function (root) {
    'use strict';

    const t = (total, nacional, internacional) => ({ total, nacional, internacional });

    // Un oficio enviado: [día, ops del día, mes, ops del mes, año, ops del año,
    // histórico, ops del histórico], cada uno t(total, nacional, internacional);
    // la carga en toneladas enteras.
    const oficio = (fecha, [pd, od, pm, om, pa, oa, ph, oh], [cd, ocd, cm, ocm, ca, oca, ch, och]) => ({
        fecha,
        pasajeros: { dia: { pax: pd, ops: od }, mes: { pax: pm, ops: om }, anio: { pax: pa, ops: oa }, historico: { pax: ph, ops: oh } },
        carga: { dia: { ton: cd, ops: ocd }, mes: { ton: cm, ops: ocm }, anio: { ton: ca, ops: oca }, historico: { ton: ch, ops: och } }
    });

    const CORTES = Object.freeze([
        {
            fecha: '2026-09-30',
            pasajeros: {
                mes: { pax: t(585515, 544629, 40886), ops: t(4512, 4195, 317) },
                anio: { pax: t(5639756, 5341270, 298486), ops: t(42217, 39942, 2275) },
                historico: { pax: t(22560304, 21252299, 1308005), ops: t(178766, 167120, 11646) }
            },
            carga: {
                mes: { ton: t(35866, 911, 34955), ops: t(1311, 277, 1034) },
                anio: { ton: t(312620, 6042, 306578), ops: t(11868, 2762, 9106) },
                historico: { ton: t(1352023, 44391, 1307632), ops: t(44079, 4526, 39553) }
            }
        },
        oficio('2026-10-01',
            [t(11305, 10034, 1271), t(89, 80, 9), t(11305, 10034, 1271), t(89, 80, 9), t(5651061, 5351304, 299757), t(42306, 40022, 2284), t(22571609, 21262333, 1309276), t(178855, 167200, 11655)],
            [t(1443, 47, 1396), t(50, 9, 41), t(1443, 47, 1396), t(50, 9, 41), t(314063, 6089, 307974), t(11918, 2771, 9147), t(1353466, 44438, 1309028), t(44129, 4535, 39594)]),
        oficio('2026-10-02',
            [t(21994, 20771, 1223), t(176, 163, 13), t(33299, 30805, 2494), t(265, 243, 22), t(5673055, 5372075, 300980), t(42482, 40185, 2297), t(22593603, 21283104, 1310499), t(179031, 167363, 11668)],
            [t(1275, 28, 1247), t(40, 5, 35), t(2718, 75, 2643), t(90, 14, 76), t(315338, 6117, 309221), t(11958, 2776, 9182), t(1354741, 44466, 1310275), t(44169, 4540, 39629)]),
        oficio('2026-10-03',
            [t(25933, 24184, 1749), t(180, 168, 12), t(59232, 54989, 4243), t(445, 411, 34), t(5698988, 5396259, 302729), t(42662, 40353, 2309), t(22619536, 21307288, 1312248), t(179211, 167531, 11680)],
            [t(1451, 18, 1433), t(41, 3, 38), t(4169, 93, 4076), t(131, 17, 114), t(316789, 6135, 310654), t(11999, 2779, 9220), t(1356192, 44484, 1311708), t(44210, 4543, 39667)]),
        oficio('2026-10-04',
            [t(17861, 16441, 1420), t(119, 109, 10), t(77093, 71430, 5663), t(564, 520, 44), t(5716849, 5412700, 304149), t(42781, 40462, 2319), t(22637397, 21323729, 1313668), t(179330, 167640, 11690)],
            [t(1098, 34, 1064), t(30, 2, 28), t(5267, 127, 5140), t(161, 19, 142), t(317887, 6169, 311718), t(12029, 2781, 9248), t(1357290, 44518, 1312772), t(44240, 4545, 39695)]),
        oficio('2026-10-05',
            [t(24425, 22822, 1603), t(177, 165, 12), t(101518, 94252, 7266), t(741, 685, 56), t(5741274, 5435522, 305752), t(42958, 40627, 2331), t(22661822, 21346551, 1315271), t(179507, 167805, 11702)],
            // Carga: lo enviado ese día. El libro editó después el bloque (305 t / 12
            // ops, mes 5,572 / 173) para quitar los vuelos de septiembre del mes.
            [t(1543, 106, 1437), t(52, 13, 39), t(6810, 233, 6577), t(213, 32, 181), t(319430, 6275, 313155), t(12081, 2794, 9287), t(1358833, 44624, 1314209), t(44292, 4558, 39734)]),
        oficio('2026-10-06',
            [t(18112, 17251, 861), t(144, 138, 6), t(119630, 111503, 8127), t(885, 823, 62), t(5759386, 5452773, 306613), t(43102, 40765, 2337), t(22679934, 21363802, 1316132), t(179651, 167943, 11708)],
            [t(726, 45, 681), t(38, 11, 27), t(7536, 278, 7258), t(251, 43, 208), t(320156, 6320, 313836), t(12119, 2805, 9314), t(1359559, 44669, 1314890), t(44330, 4569, 39761)]),
        oficio('2026-10-07',
            [t(17106, 14993, 2113), t(142, 128, 14), t(136736, 126496, 10240), t(1027, 951, 76), t(5776492, 5467766, 308726), t(43244, 40893, 2351), t(22697040, 21378795, 1318245), t(179793, 168071, 11722)],
            [t(1132, 51, 1081), t(40, 7, 33), t(8668, 329, 8339), t(291, 50, 241), t(321288, 6371, 314917), t(12159, 2812, 9347), t(1360691, 44720, 1315971), t(44370, 4576, 39794)]),
        oficio('2026-10-08',
            [t(14717, 14151, 566), t(107, 103, 4), t(151453, 140647, 10806), t(1134, 1054, 80), t(5791209, 5481917, 309292), t(43351, 40996, 2355), t(22711757, 21392946, 1318811), t(179900, 168174, 11726)],
            [t(1168, 11, 1157), t(36, 0, 36), t(9836, 340, 9496), t(327, 50, 277), t(322456, 6382, 316074), t(12195, 2812, 9383), t(1361859, 44731, 1317128), t(44406, 4576, 39830)]),
        oficio('2026-10-09',
            [t(27124, 24450, 2674), t(205, 183, 22), t(178577, 165097, 13480), t(1339, 1237, 102), t(5818333, 5506367, 311966), t(43556, 41179, 2377), t(22738881, 21417396, 1321485), t(180105, 168357, 11748)],
            [t(1354, 77, 1277), t(45, 9, 36), t(11190, 417, 10773), t(372, 59, 313), t(323810, 6459, 317351), t(12240, 2821, 9419), t(1363213, 44808, 1318405), t(44451, 4585, 39866)]),
        oficio('2026-10-10',
            [t(23727, 22100, 1627), t(178, 167, 11), t(202304, 187197, 15107), t(1517, 1404, 113), t(5842060, 5528467, 313593), t(43734, 41346, 2388), t(22762608, 21439496, 1323112), t(180283, 168524, 11759)],
            [t(852, 44, 808), t(31, 5, 26), t(12042, 461, 11581), t(403, 64, 339), t(324662, 6503, 318159), t(12271, 2826, 9445), t(1364065, 44852, 1319213), t(44482, 4590, 39892)]),
        oficio('2026-10-11',
            [t(15157, 14141, 1016), t(105, 98, 7), t(217461, 201338, 16123), t(1622, 1502, 120), t(5857217, 5542608, 314609), t(43839, 41444, 2395), t(22777765, 21453637, 1324128), t(180388, 168622, 11766)],
            [t(1300, 1, 1299), t(32, 4, 28), t(13342, 462, 12880), t(435, 68, 367), t(325962, 6504, 319458), t(12303, 2830, 9473), t(1365365, 44853, 1320512), t(44514, 4594, 39920)]),
        oficio('2026-10-12',
            [t(24511, 22823, 1688), t(183, 172, 11), t(231613, 215202, 16411), t(1718, 1601, 117), t(5881728, 5565431, 316297), t(44022, 41616, 2406), t(22802276, 21476460, 1325816), t(180571, 168794, 11777)],
            [t(1086, 59, 1027), t(38, 7, 31), t(13189, 469, 12720), t(433, 66, 367), t(327048, 6563, 320485), t(12341, 2837, 9504), t(1366451, 44912, 1321539), t(44552, 4601, 39951)]),
        oficio('2026-10-13',
            [t(17037, 15879, 1158), t(130, 122, 8), t(248650, 231081, 17569), t(1848, 1723, 125), t(5898765, 5581310, 317455), t(44152, 41738, 2414), t(22819313, 21492339, 1326974), t(180701, 168916, 11785)],
            [t(704, 63, 641), t(27, 7, 20), t(13893, 532, 13361), t(460, 73, 387), t(327752, 6626, 321126), t(12368, 2844, 9524), t(1367155, 44975, 1322180), t(44579, 4608, 39971)]),
        oficio('2026-10-14',
            [t(17232, 15540, 1692), t(115, 104, 11), t(265882, 246621, 19261), t(1963, 1827, 136), t(5915997, 5596850, 319147), t(44267, 41842, 2425), t(22836545, 21507879, 1328666), t(180816, 169020, 11796)],
            [t(1221, 4, 1217), t(33, 0, 33), t(15114, 536, 14578), t(493, 73, 420), t(328973, 6630, 322343), t(12401, 2844, 9557), t(1368376, 44979, 1323397), t(44612, 4608, 40004)]),
        oficio('2026-10-15',
            [t(20838, 19647, 1191), t(165, 157, 8), t(286720, 266268, 20452), t(2128, 1984, 144), t(5936835, 5616497, 320338), t(44432, 41999, 2433), t(22857383, 21527526, 1329857), t(180981, 169177, 11804)],
            [t(1880, 39, 1841), t(64, 7, 57), t(16994, 575, 16419), t(557, 80, 477), t(330853, 6669, 324184), t(12465, 2851, 9614), t(1370256, 45018, 1325238), t(44676, 4615, 40061)]),
        oficio('2026-10-16',
            [t(22514, 21159, 1355), t(171, 161, 10), t(309234, 287427, 21807), t(2299, 2145, 154), t(5959349, 5637656, 321693), t(44603, 42160, 2443), t(22879897, 21548685, 1331212), t(181152, 169338, 11814)],
            [t(1368, 8, 1360), t(38, 0, 38), t(18362, 583, 17779), t(595, 80, 515), t(332221, 6677, 325544), t(12503, 2851, 9652), t(1371624, 45026, 1326598), t(44714, 4615, 40099)]),
        oficio('2026-10-17',
            [t(28823, 27224, 1599), t(200, 189, 11), t(338057, 314651, 23406), t(2499, 2334, 165), t(5988172, 5664880, 323292), t(44803, 42349, 2454), t(22908720, 21575909, 1332811), t(181352, 169527, 11825)],
            [t(1529, 116, 1413), t(50, 12, 38), t(19891, 699, 19192), t(645, 92, 553), t(333750, 6793, 326957), t(12553, 2863, 9690), t(1373153, 45142, 1328011), t(44764, 4627, 40137)]),
        oficio('2026-10-18',
            [t(15127, 13960, 1167), t(108, 97, 11), t(353184, 328611, 24573), t(2607, 2431, 176), t(6003299, 5678840, 324459), t(44911, 42446, 2465), t(22923847, 21589869, 1333978), t(181460, 169624, 11836)],
            [t(1558, 0, 1558), t(36, 1, 35), t(21449, 699, 20750), t(681, 93, 588), t(335308, 6793, 328515), t(12589, 2864, 9725), t(1374711, 45142, 1329569), t(44800, 4628, 40172)]),
        oficio('2026-10-19',
            [t(20790, 19667, 1123), t(154, 146, 8), t(373974, 348278, 25696), t(2761, 2577, 184), t(6024089, 5698507, 325582), t(45065, 42592, 2473), t(22944637, 21609536, 1335101), t(181614, 169770, 11844)],
            [t(1801, 15, 1786), t(54, 7, 47), t(23250, 714, 22536), t(735, 100, 635), t(337109, 6808, 330301), t(12643, 2871, 9772), t(1376512, 45157, 1331355), t(44854, 4635, 40219)]),
        // El mensaje enviado. El día lleva ajustes que el libro no trae en DATA:
        // pasajeros +1 internacional (el del 19: se envió 1,123, el libro 1,124);
        // carga −6 t (Cathay 97 del 16: 19,657 → 13,525 kg) y un vuelo contado
        // como nacional (3 / 31 ops; DATA 2 / 32).
        oficio('2026-10-20',
            [t(24114, 22494, 1620), t(173, 162, 11), t(398088, 370772, 27316), t(2934, 2739, 195), t(6048203, 5721001, 327202), t(45238, 42754, 2484), t(22968751, 21632030, 1336721), t(181787, 169932, 11855)],
            [t(948, 15, 933), t(34, 3, 31), t(24198, 729, 23469), t(769, 103, 666), t(338057, 6823, 331234), t(12677, 2874, 9803), t(1377460, 45172, 1332288), t(44888, 4638, 40250)]),
        // El mensaje enviado: pasajeros +1 nacional sobre el libro (21,125 / 19,755).
        oficio('2026-10-21',
            [t(21126, 19756, 1370), t(160, 151, 9), t(419214, 390528, 28686), t(3094, 2890, 204), t(6069329, 5740757, 328572), t(45398, 42905, 2493), t(22989877, 21651786, 1338091), t(181947, 170083, 11864)],
            [t(639, 72, 567), t(28, 9, 19), t(24837, 801, 24036), t(797, 112, 685), t(338696, 6895, 331801), t(12705, 2883, 9822), t(1378099, 45244, 1332855), t(44916, 4647, 40269)]),
    ]);

    // Dato del día tal como se envió, cuando el libro cambió después.
    const ENVIADOS = Object.freeze({
        carga: {
            // El libro hoy: 1,448 t (48 nac / 1,400 int).
            '2026-10-01': { ton: t(1443, 47, 1396), ops: t(50, 9, 41) },
            // El libro hoy: 1,275 t (25 / 1,250) y 40 ops (4 / 36).
            '2026-10-02': { ton: t(1275, 28, 1247), ops: t(40, 5, 35) }
        }
    });

    /** El saldo que usa un corte: el más reciente a esa fecha (o el primero). */
    function vigente(corteIso) {
        let elegido = CORTES[0];
        for (const c of CORTES) if (c.fecha <= String(corteIso || '')) elegido = c;
        return elegido;
    }

    /* ── 2025 para la variación del mensaje del SWEAR ──────────────────────
       La base no tiene 2025. Fuente: "VARIACION 2025-2026..xlsx": totales
       por mes de enero a septiembre y día por día de enero, marzo y octubre
       (pasajeros por FECHA; carga en kilos, como "Suma de Total dia").
       El acumulado del año a una fecha es, como en el libro, la suma de los
       meses anteriores más los días del mes hasta esa fecha; la carga se
       pasa a toneladas al final y se redondea a enteras. */
    const MENSUAL_2025 = Object.freeze({
        pax: [565716, 488440, 570097, 621197, 586299, 541400, 604758, 630952, 546457],
        ton: [27764.46673, 26629, 33154.9695, 30786, 34191, 37708, 35650, 35738, 31077]
    });
    const DIARIO_2025 = Object.freeze({
        1: {
            pax: [18182, 21938, 22306, 21610, 22149, 20745, 18238, 17462, 19715, 19175, 18688, 18827, 18175, 16606, 16226, 18590,
                18331, 16684, 17186, 17490, 15385, 15233, 17622, 18271, 16052, 17734, 17030, 15685, 15654, 19264, 19463],
            kg: [707685.5, 912897.98, 800832, 530461.79, 986822.9, 421972.47, 744234, 578863.32, 984198.84, 957389, 929448.68,
                1348112.66, 497820.65, 972790.4, 973294, 1246063.28, 891908.7, 1038311.04, 963059.9, 325220.5, 1002346.5,
                1058377.68, 1363594.92, 1086419, 486629.18, 1268438.7, 506957.18, 958825.16, 1062069.8, 1024168.4, 1135252.6]
        },
        3: {
            pax: [17191, 18992, 17891, 16611, 16434, 17468, 19238, 17111, 18444, 17792, 16539, 17038, 20149, 21042, 19025, 18453,
                20128, 18100, 16985, 19343, 18844, 17892, 18601, 19433, 17417, 16320, 19425, 19658, 17343, 20807, 20383],
            kg: [934565.94, 1060629.4, 721501, 972044, 1066970, 1210679.95, 1351992, 1024642.1, 1064597.6, 886742.8, 896986.8,
                1228955, 1017019.22, 1473763, 1009889.46, 994788.1, 621486.24, 786933.8, 1277767, 1475012.25, 1452922,
                1172004.91, 1002222.7, 914525.9, 779425, 1167455.1, 1492042.7, 1498928.08, 779213.55, 949172.9, 870091]
        },
        10: {
            pax: [16083, 17538, 19170, 15798, 19435, 19307, 15557, 16465, 19570, 19623, 16215, 19450, 19732, 16814, 18050, 19633,
                20384, 16920, 21081, 20397, 17745, 18818, 19666, 21088, 17407, 20828, 21187, 17245, 18609, 21687, 23127],
            kg: [1241308.6, 1357422.3, 1144062.61, 850463, 876297.4, 1408031.6, 891139, 1172892, 1102327.13, 1170382, 936449.77,
                1228164.85, 1183070.1, 976093.93, 1195961.76, 1417625.3, 1261250, 812523.48, 1047218.2, 1528736, 1358253.45,
                1448745.6, 1412297.9, 1418474, 977014.18, 963321.3, 1256267, 1130138.5, 1504360.35, 1695658.8, 1307460.5]
        }
    });

    /** Total de un mes de 2025: el del libro o, si sólo hay días, su suma. */
    function mes2025(mes) {
        if (mes <= MENSUAL_2025.pax.length) return { pax: MENSUAL_2025.pax[mes - 1], ton: MENSUAL_2025.ton[mes - 1] };
        const d = DIARIO_2025[mes];
        if (!d || d.pax.length !== new Date(2025, mes, 0).getDate()) return null;
        return { pax: d.pax.reduce((s, v) => s + v, 0), ton: d.kg.reduce((s, v) => s + v, 0) / 1000 };
    }

    /**
     * Acumulado del año 2025 al día dado (AAAA-MM-DD): { pax, ton, tonExacta }
     * con las toneladas enteras y sin redondear (el porcentaje del SWEAR se
     * saca con éstas: el 16/10/2026 da 6.87 %, con las enteras 6.88 %), o null
     * si el libro no alcanza para esa fecha (no se inventa: sin los días del
     * mes, sólo vale el último día de ese mes).
     */
    function acumuladoAnioAnterior(iso) {
        const [anio, mes, dia] = String(iso || '').split('-').map(Number);
        if (anio !== 2025 || !(mes >= 1 && mes <= 12) || !(dia >= 1)) return null;
        let pax = 0;
        let ton = 0;
        for (let m = 1; m < mes; m++) {
            const t = mes2025(m);
            if (!t) return null;
            pax += t.pax;
            ton += t.ton;
        }
        const d = DIARIO_2025[mes];
        if (d) {
            if (dia > d.pax.length) return null;
            for (let i = 0; i < dia; i++) { pax += d.pax[i]; ton += d.kg[i] / 1000; }
        } else {
            const t = mes2025(mes);
            if (!t || dia !== new Date(2025, mes, 0).getDate()) return null;
            pax += t.pax;
            ton += t.ton;
        }
        return { pax, ton: Math.round(ton), tonExacta: ton };
    }

    /**
     * ¿El saldo de este alcance aplica a un corte? El mes, si es el mismo mes;
     * el año, si es el mismo año; desde el inicio, siempre; el día, sólo el
     * del propio oficio. Sin fecha de saldo, la del que usa ese corte.
     */
    function aplica(alcance, corteIso, fechaSaldo = vigente(corteIso).fecha) {
        if (alcance === 'historico') return true;
        if (alcance === 'dia') return corteIso === fechaSaldo;
        if (alcance === 'anio') return corteIso.slice(0, 4) === fechaSaldo.slice(0, 4);
        if (alcance === 'mes') return corteIso.slice(0, 7) === fechaSaldo.slice(0, 7);
        return false;
    }

    // fecha / pasajeros / carga: los del primer saldo, como antes de haber varios.
    root.ConciSaldosOficio = { ...CORTES[0], cortes: CORTES, enviados: ENVIADOS, vigente, aplica, acumuladoAnioAnterior };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ConciSaldosOficio;
})(typeof window !== 'undefined' ? window : globalThis);
