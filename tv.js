/* =====================================================
   tv.js — painel de TV (somente leitura)
   JavaScript antigo (ES5): sem módulos, sem SDK do Firebase.
   Lê o documento agenda/principal pela API REST do Firestore
   a cada 60 segundos. É carregado só quando o link tem ?tv=1.

   Depende de agenda-utils.js (datas, ordenação e "próximo evento",
   compartilhados com app.js), que o index.html carrega antes deste.

   Obs.: a chave abaixo é a mesma do firebase.js. Chaves de app web
   do Firebase não são segredo; quem protege os dados são as regras
   do Firestore.
===================================================== */
(function () {
    "use strict";

    var U = window.AgendaUtil;

    var PROJETO = "drecac-3daaf";
    var API_KEY = window.AGENDA_FIREBASE_KEY || "";
    var URL_AGENDA = "https://firestore.googleapis.com/v1/projects/" + PROJETO +
        "/databases/(default)/documents/agenda/principal?key=" + API_KEY;

    var INTERVALO_MS = 60 * 1000;

    document.body.className += " tv";

    var tbody = document.getElementById("tbody");
    var totalEventos = document.getElementById("totalEventos");
    var eventosHoje = document.getElementById("eventosHoje");
    var textoBarra = document.getElementById("textoBarra");
    var avisos = document.getElementById("avisos");

    var cache = [];
    var ultimoTexto = "";

    /* ---------- mensagem de erro visível ---------- */

    function mostrarErroTela(texto) {
        var el = document.getElementById("erroTela");
        if (!el) {
            el = document.createElement("div");
            el.id = "erroTela";
            document.body.appendChild(el);
        }
        el.textContent = texto || "";
        el.style.display = texto ? "block" : "none";
    }

    /* ---------- classes ---------- */

    function addClass(el, c) {
        if ((" " + el.className + " ").indexOf(" " + c + " ") === -1) {
            el.className = el.className ? el.className + " " + c : c;
        }
    }

    function removeClass(el, c) {
        el.className = (" " + el.className + " ").replace(" " + c + " ", " ").replace(/^\s+|\s+$/g, "");
    }

    /* ---------- datas e horas (vêm de agenda-utils.js) ---------- */

    var hojeZero = U.hojeZero;
    var converterData = U.converterData;
    var formatarDataCurta = U.formatarDataCurta;

    /* ---------- leitura do formato da API REST do Firestore ---------- */

    function valor(c) {
        if (!c) return "";
        if (c.stringValue !== undefined) return c.stringValue;
        if (c.integerValue !== undefined) return String(c.integerValue);
        if (c.doubleValue !== undefined) return String(c.doubleValue);
        return "";
    }

    function lerAgenda(doc) {
        var lista = [];
        var campo = doc && doc.fields && doc.fields.agenda;
        var valores = campo && campo.arrayValue && campo.arrayValue.values;
        if (!valores) return lista;
        for (var i = 0; i < valores.length; i++) {
            var f = valores[i].mapValue && valores[i].mapValue.fields;
            if (!f) continue;
            lista.push({
                inicio: valor(f.inicio),
                fim: valor(f.fim),
                horario: valor(f.horario),
                aviso: valor(f.aviso) || "15",
                periodo: valor(f.periodo),
                acao: valor(f.acao),
                responsavel: valor(f.responsavel),
                _i: i
            });
        }
        return lista;
    }

    /* ---------- desenho da tabela ---------- */

    function desenhar(lista) {
        var hoje = hojeZero();
        var ativos = 0;
        var i, j;

        U.ordenar(lista, hoje);
        tbody.innerHTML = "";

        for (i = 0; i < lista.length; i++) {
            var it = lista[i];
            var tr = document.createElement("tr");
            var cel = [
                formatarDataCurta(it.inicio), formatarDataCurta(it.fim),
                it.horario, it.aviso, it.periodo, it.acao, it.responsavel
            ];

            for (j = 0; j < cel.length; j++) {
                var td = document.createElement("td");
                td.textContent = cel[j];
                tr.appendChild(td);
            }

            var ini = converterData(it.inicio);
            var fim = converterData(it.fim);

            if (ini && fim && hoje >= ini && hoje <= fim) {
                addClass(tr, "evento-hoje");
                ativos++;
            }

            var periodos = U.classesPeriodo(it.periodo);
            for (j = 0; j < periodos.length; j++) addClass(tr, "periodo-" + periodos[j]);

            if (fim && fim < hoje) addClass(tr, "evento-passado");

            it._tr = tr;
            tbody.appendChild(tr);
        }

        totalEventos.textContent = lista.length;
        eventosHoje.textContent = ativos;

        if (typeof reiniciarRolagem === "function") reiniciarRolagem();
        if (typeof ajustarEscala === "function") ajustarEscala();
        if (typeof montarCarrossel === "function") montarCarrossel();
        if (typeof montarInfinita === "function") montarInfinita();

        barraUnidade = "";   // força remontar o letreiro com as medidas novas
        atualizarBarra();
    }

    /* ---------- barra do próximo evento ----------
       A regra de qual é o "próximo evento" está em agenda-utils.js
       (a mesma usada na página de edição). */

    function atualizarBarra() {
        var agora = new Date();
        var i, k;

        for (i = 0; i < cache.length; i++) {
            if (cache[i]._tr) removeClass(cache[i]._tr, "evento-urgente");
            if (cache[i]._clones) {
                for (k = 0; k < cache[i]._clones.length; k++) removeClass(cache[i]._clones[k], "evento-urgente");
            }
        }

        var p = U.proximoEvento(cache, agora);

        definirTextoBarra(p ? p.texto : "Nenhum evento programado.");

        if (!p) return;

        // faltando 5 minutos ou menos: destaca a linha (e as cópias da rolagem infinita)
        if (p.temHora && p.ms <= 300000 && p.item._tr) {
            addClass(p.item._tr, "evento-urgente");
            if (p.item._clones) {
                for (k = 0; k < p.item._clones.length; k++) addClass(p.item._clones[k], "evento-urgente");
            }
        }
    }

    /* ---------- letreiro da barra do próximo evento (em loop) ----------
       O texto passa da direita para a esquerda sem parar. Para a emenda ser
       perfeita, o texto é repetido (separado por " • ") e a faixa volta ao
       ponto inicial a cada "unidade" completa. A barra tem comprimento fixo
       e vai até o logo. Feito em JavaScript com
       transform, sem depender de animação CSS (TVs antigas podem não rodá-la). */

    var VELOCIDADE_BARRA_PX_S = 100;     // velocidade do letreiro (pixels por segundo)
    var SEPARADOR_BARRA = "\u00a0\u00a0\u2022\u00a0\u00a0";

    var barraUnidade = "";
    var barraPos = 0;
    var barraP = 0;
    var barraUlt = 0;
    var contBarra = document.getElementById("barraEvento");

    function montarBarra() {
        if (!contBarra) return;

        // 1) mede uma unidade (texto + separador)
        textoBarra.textContent = barraUnidade + SEPARADOR_BARRA;
        barraP = textoBarra.offsetWidth;

        // 2) a barra tem comprimento definido pelo layout: ocupa todo o espaço
        //    entre o canto esquerdo e o logo (ver "body.tv #barraEvento" no CSS)
        var b = contBarra.clientWidth;

        // 3) repete a unidade até cobrir a barra + 1 unidade (sem buracos).
        //    Com a placa de vídeo fazendo o movimento, repete mais vezes (até
        //    ~3000 px) para a faixa andar vários trechos antes de recomeçar.
        var minimo = Math.max(Math.ceil(b / Math.max(barraP, 1)) + 1, 2);
        var n = minimo;
        if (SUPORTA_TRANSICAO) n = Math.min(Math.max(minimo, Math.floor(3000 / Math.max(barraP, 1))), 60);
        var s = "";
        for (var i = 0; i < n; i++) s += barraUnidade + SEPARADOR_BARRA;
        textoBarra.textContent = s;

        barraPos = -b;      // começa entrando pela direita (modo de reserva)
        barraUlt = 0;

        if (SUPORTA_TRANSICAO) {
            // viagem = múltiplo exato da unidade, para a volta ao início ser invisível
            barraViagem = (n - Math.ceil(b / Math.max(barraP, 1))) * barraP;
            barraLargura = b;
            cicloBarra(true);
        }
    }

    var barraViagem = 0;
    var barraLargura = 0;

    function cicloBarra(primeira) {
        if (!barraP || !barraViagem) return;
        correr(textoBarra, primeira ? barraLargura : 0, -barraViagem, VELOCIDADE_BARRA_PX_S, function () {
            cicloBarra(false);
        });
    }

    function definirTextoBarra(texto) {
        if (texto === barraUnidade) return;
        barraUnidade = texto;
        montarBarra();
    }

    function quadroBarra(agora) {
        if (barraP > 0) {
            var dt = barraUlt ? Math.min(agora - barraUlt, 250) : 0;
            barraUlt = agora;

            barraPos += VELOCIDADE_BARRA_PX_S * dt / 1000;
            if (barraPos >= barraP) barraPos -= barraP;

            var v = "translate3d(" + (-barraPos) + "px,0,0)";
            textoBarra.style.webkitTransform = v;
            textoBarra.style.transform = v;
        }
    }

    function iniciarBarra() {
        if (!contBarra) return;

        textoBarra.style.animation = "none";
        textoBarra.style.webkitAnimation = "none";
        textoBarra.style.whiteSpace = "nowrap";
        textoBarra.style.webkitFlex = "0 0 auto";
        textoBarra.style.flex = "0 0 auto";
        textoBarra.style.webkitBackfaceVisibility = "hidden";

        contBarra.style.webkitJustifyContent = "flex-start";
        contBarra.style.justifyContent = "flex-start";

        if (!SUPORTA_TRANSICAO) passos.push(quadroBarra);
    }

    /* ---------- busca da agenda ---------- */

    function carregar() {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", URL_AGENDA, true);
        xhr.timeout = 20000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;

            if (xhr.status === 200) {
                if (xhr.responseText === ultimoTexto) {
                    mostrarErroTela("");
                    return; // nada mudou: não redesenha (preserva a rolagem)
                }

                try {
                    var doc = JSON.parse(xhr.responseText);
                    cache = lerAgenda(doc);
                    ultimoTexto = xhr.responseText;
                    desenhar(cache);
                    mostrarErroTela("");
                } catch (e) {
                    mostrarErroTela("Erro ao ler a agenda: " + (e && e.message ? e.message : e));
                }
                return;
            }

            if (xhr.status === 403) {
                mostrarErroTela("Sem permissão para ler a agenda (verifique as regras do Firestore).");
            } else if (xhr.status === 404) {
                mostrarErroTela("Agenda não encontrada no banco de dados.");
            } else {
                mostrarErroTela("Sem conexão com o banco de dados (código " + xhr.status + "). Tentando novamente…");
            }
        };

        xhr.send();
    }

    /* ---------- notícias ---------- */

    /* As manchetes passam em GRUPOS CURTOS. Uma faixa única com todas as notícias
       fica com milhares de pixels de largura; TVs e navegadores simples não
       conseguem manter uma imagem tão larga na placa de vídeo e passam a
       redesenhar o texto a cada quadro, o que faz o movimento travar.
       O grupo novo só entra quando o anterior termina de passar. */

    var SEPARADOR_NOTICIAS = "     \u2022     ";
    var MAX_CARACTERES_GRUPO = 260;
    var noticias = [];
    var noticiaIdx = 0;

    function definirNoticias(lista) {
        noticias = lista;
        noticiaIdx = 0;
    }

    // devolve o próximo grupo de manchetes (ou "" se ainda não há notícias)
    function proximoGrupoNoticias() {
        if (!noticias.length) return "";
        var texto = "", usados = 0;
        while (usados < noticias.length) {
            texto += noticias[noticiaIdx] + SEPARADOR_NOTICIAS;
            noticiaIdx = (noticiaIdx + 1) % noticias.length;
            usados++;
            if (texto.length >= MAX_CARACTERES_GRUPO) break;
        }
        return texto;
    }

    // Mesmas fontes de reserva da página de edição. Cada feed (de educação e,
    // se falhar, o geral) é tentado por cada serviço, até algum devolver manchetes.
    var FONTES_NOTICIAS = [
        { tipo: "json", url: function (f) { return "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(f); } },
        { tipo: "xml", url: function (f) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(f); } },
        { tipo: "xml", url: function (f) { return "https://corsproxy.io/?url=" + encodeURIComponent(f); } }
    ];

    // devolve a lista de títulos (pode vir vazia)
    function extrairTitulos(tipo, texto) {
        var lista = [], i, t;
        if (tipo === "json") {
            var d = JSON.parse(texto);
            if (d.status !== "ok" || !d.items) return lista;
            for (i = 0; i < d.items.length; i++) lista.push(d.items[i].title);
        } else {
            // sem DOMParser (TVs antigas): lê os <title> dentro de cada <item>
            var itens = texto.split(/<item[\s>]/i);
            for (i = 1; i < itens.length; i++) {
                var m = itens[i].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                if (m) {
                    t = m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
                    lista.push(t);
                }
            }
        }
        return lista;
    }

    function carregarNoticias() {
        var tentativas = [], f, s;
        for (f = 0; f < U.RSS_FEEDS.length; f++) {
            for (s = 0; s < FONTES_NOTICIAS.length; s++) {
                tentativas.push({ feed: U.RSS_FEEDS[f], fonte: FONTES_NOTICIAS[s] });
            }
        }

        function tentar(n) {
            if (n >= tentativas.length) return;   // nada deu certo: mantém o texto atual do rodapé

            var tent = tentativas[n];
            var xhr = new XMLHttpRequest();
            var seguiu = false;

            function proxima() {
                if (seguiu) return;
                seguiu = true;
                tentar(n + 1);
            }

            xhr.open("GET", tent.fonte.url(tent.feed), true);
            xhr.timeout = 15000;

            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4 || seguiu) return;
                if (xhr.status !== 200) { proxima(); return; }
                try {
                    var brutos = extrairTitulos(tent.fonte.tipo, xhr.responseText);
                    var titulos = [];
                    for (var i = 0; i < brutos.length && titulos.length < 8; i++) {
                        var t = String(brutos[i] || "").trim();
                        if (t && U.manchetePermitida(t)) titulos.push(t);
                    }
                    if (titulos.length) {
                        seguiu = true;
                        definirNoticias(titulos);
                    } else {
                        proxima();
                    }
                } catch (e) { proxima(); }
            };

            xhr.send();
        }

        tentar(0);
    }

    /* ---------- rolagem automática (contínua e suave) ----------
       Modo escolhido em MODO_TABELA: "infinita" (rola sem parar, em ciclo),
       "carrossel" (páginas que trocam sozinhas), "continua" (desce e volta
       ao topo) ou "nenhuma".
       Começa na hora, sem pausa no topo. Ao chegar ao fim espera um
       instante (PAUSA_FIM_MS) e recomeça do topo. Se todas as linhas
       cabem na tela, não rola. Ajuste a velocidade abaixo. */

    var MODO_TABELA = "infinita";     // "infinita" | "carrossel" | "continua" | "nenhuma"
    if (MODO_TABELA === "infinita") document.body.className += " infinita";
    var TEMPO_PAGINA_MS = 10000;      // carrossel: tempo de cada página (10 s)
    var LINHAS_MINIMAS = 3;           // pelo menos tantas linhas de evento visíveis na tela
    var ESCALA_MINIMA = 0.5;          // até quanto o layout pode encolher para isso (0.5 = metade)
    var VELOCIDADE_PX_S = 20;   // pixels por segundo (maior = mais rápido)
    var PAUSA_FIM_MS = 1500;    // pausa ao chegar ao fim (0 = sem pausa)

    var pos = 0;
    var ultimoQuadro = 0;
    var pausaAte = 0;

    function raf(f) {
        var r = window.requestAnimationFrame || window.webkitRequestAnimationFrame;
        if (r) return r.call(window, f);
        return setTimeout(function () { f(new Date().getTime()); }, 16);
    }

    /* Laço de animação único. Antes cada movimento (letreiro, ticker, rolagem)
       tinha o seu próprio requestAnimationFrame; agora todos rodam no mesmo
       quadro, com uma única leitura do relógio. Se um passo der erro, só ele
       é desligado e os outros continuam. */
    var passos = [];

    /* ---------- movimento dos letreiros pela placa de vídeo ----------
       Antes os dois letreiros eram movidos quadro a quadro pelo JavaScript,
       no mesmo processador que também move a tabela, mede e redesenha; se a
       TV atrasa um quadro, o letreiro "trava". Agora o JavaScript só diz
       "vá da posição A até a B nesta velocidade" (transição de transform) e
       a placa de vídeo faz o movimento sozinha, mesmo que o processador
       esteja ocupado. Se a TV for antiga demais para isso, o modo quadro a
       quadro de antes continua como reserva automática. */

    var SUPORTA_TRANSICAO = (function () {
        var st = document.body.style;
        return ("transition" in st) || ("webkitTransition" in st);
    })();

    function aplicarTransform(el, v) {
        el.style.webkitTransform = v;
        el.style.transform = v;
    }

    // Move "el" de "de" até "para" (pixels, no eixo X), em velocidade constante,
    // e chama "fim" quando termina.
    function correr(el, de, para, pxPorSeg, fim) {
        var dur = Math.max(Math.abs(de - para) / pxPorSeg, 0.2);
        var token = (el._tokenMov || 0) + 1;
        el._tokenMov = token;

        // 1) vai para o ponto de partida, sem animação
        el.style.webkitTransition = "none";
        el.style.transition = "none";
        aplicarTransform(el, "translate3d(" + de + "px,0,0)");
        void el.offsetWidth;                       // confirma a posição inicial

        // 2) anima até o ponto final
        el.style.webkitTransition = "-webkit-transform " + dur + "s linear";
        el.style.transition = "transform " + dur + "s linear";
        aplicarTransform(el, "translate3d(" + para + "px,0,0)");

        // 3) avisa quando terminar (fim da transição ou, por segurança, um relógio)
        var acabou = false;
        function terminar() {
            if (acabou || el._tokenMov !== token) return;
            acabou = true;
            el.removeEventListener("transitionend", aoTerminar, false);
            el.removeEventListener("webkitTransitionEnd", aoTerminar, false);
            fim();
        }
        function aoTerminar(e) {
            if (e && e.target !== el) return;
            terminar();
        }
        el.addEventListener("transitionend", aoTerminar, false);
        el.addEventListener("webkitTransitionEnd", aoTerminar, false);
        setTimeout(terminar, dur * 1000 + 600);
    }

    function laco(ts) {
        // O horário que o navegador entrega a cada quadro está sincronizado com a
        // tela; usar new Date() aqui causava passos desiguais (efeito "travando").
        var agora = (typeof ts === "number" && ts > 0) ? ts : new Date().getTime();
        for (var i = 0; i < passos.length; i++) {
            try {
                passos[i](agora);
            } catch (e) {
                passos.splice(i, 1);
                i--;
                mostrarErroTela("Erro na animação: " + (e && e.message ? e.message : e));
            }
        }
        raf(laco);
    }

    function reiniciarRolagem() {
        var cont = document.querySelector(".table-container");
        pos = 0;
        pausaAte = 0;
        ultimoQuadro = 0;
        if (cont && MODO_TABELA === "continua") cont.scrollTop = 0;
    }

    function quadro(agora) {
        var cont = document.querySelector(".table-container");

        if (cont) {
            cont.style.scrollBehavior = "auto";

            var max = cont.scrollHeight - cont.clientHeight;
            var dt = ultimoQuadro ? Math.min(agora - ultimoQuadro, 250) : 0;
            ultimoQuadro = agora;

            if (max <= 4) {
                pos = 0;
                cont.scrollTop = 0;
            } else if (agora >= pausaAte) {
                if (pausaAte) {      // terminou a pausa do fim: volta ao topo
                    pausaAte = 0;
                    pos = 0;
                }
                pos += VELOCIDADE_PX_S * dt / 1000;
                if (pos >= max) {
                    pos = max;
                    pausaAte = agora + PAUSA_FIM_MS;
                }
                cont.scrollTop = pos;
            }
        }
    }

    /* ---------- carrossel de páginas ----------
       Divide a tabela em páginas que cabem na tela e troca de página
       sozinho (com um fade rápido), com bolinhas indicando a página. */

    var ALTURA_DOTS = 36;
    var paginas = [];
    var paginaAtual = 0;
    var dotsEl = document.getElementById("paginationDots");

    function atualizarDots() {
        if (!dotsEl) return;
        dotsEl.innerHTML = "";
        if (paginas.length <= 1) {
            dotsEl.style.display = "none";
            return;
        }
        dotsEl.style.cssText = "display:block;text-align:center;padding:9px 0;line-height:1;";
        for (var i = 0; i < paginas.length; i++) {
            var d = document.createElement("span");
            d.style.cssText = "display:inline-block;width:14px;height:14px;margin:0 7px;border-radius:50%;background:" +
                (i === paginaAtual ? "#56d7ff" : "rgba(255,255,255,.28)");
            dotsEl.appendChild(d);
        }
    }

    function mostrarPagina(n) {
        paginaAtual = n;
        for (var p = 0; p < paginas.length; p++) {
            for (var r = 0; r < paginas[p].length; r++) {
                paginas[p][r].style.display = (p === n) ? "" : "none";
            }
        }
        atualizarDots();
    }

    function montarCarrossel() {
        if (MODO_TABELA !== "carrossel") return;

        var cont = document.querySelector(".table-container");
        if (!cont) return;

        var linhas = [];
        var i;
        for (i = 0; i < tbody.rows.length; i++) {
            tbody.rows[i].style.display = "";
            linhas.push(tbody.rows[i]);
        }

        if (dotsEl) dotsEl.style.display = "none";
        cont.style.overflowY = "hidden";
        paginas = [];
        paginaAtual = 0;

        if (!linhas.length || cont.scrollHeight <= cont.clientHeight + 2) {
            paginas = [linhas];       // tudo cabe: uma página só, sem trocar
            atualizarDots();
            return;
        }

        var thead = cont.querySelector("thead");
        var capacidade = cont.clientHeight - (thead ? thead.offsetHeight : 0) - ALTURA_DOTS;
        var atual = [];
        var soma = 0;

        for (i = 0; i < linhas.length; i++) {
            var h = linhas[i].offsetHeight;
            if (atual.length && soma + h > capacidade) {
                paginas.push(atual);
                atual = [];
                soma = 0;
            }
            atual.push(linhas[i]);
            soma += h;
        }
        if (atual.length) paginas.push(atual);

        mostrarPagina(0);
    }

    function proximaPagina() {
        if (MODO_TABELA !== "carrossel" || paginas.length <= 1) return;

        tbody.style.setProperty("transition", "opacity .35s", "important");
        tbody.style.opacity = "0";

        setTimeout(function () {
            mostrarPagina((paginaAtual + 1) % paginas.length);
            tbody.style.opacity = "1";
        }, 380);
    }

    /* ---------- faixa de notícias (ticker) em JavaScript ----------
       Não depende de animação CSS (TVs antigas podem não rodá-la). */

    var VELOCIDADE_TICKER_PX_S = 75;

    function iniciarTicker() {
        if (!avisos) return;

        var janela = avisos.parentNode;
        var x = null;
        var ultimo = 0;
        var larg = 0;
        var jan = 0;

        avisos.style.animation = "none";
        avisos.style.webkitAnimation = "none";
        avisos.style.paddingLeft = "0";
        avisos.style.webkitBackfaceVisibility = "hidden";
        avisos.textContent = "Bem-vindos à Agenda Institucional da DRE Cáceres.";

        // Mede só quando o texto muda (a cada volta), nunca durante o movimento:
        // medir força o navegador a recalcular a página e causa um tranco.
        function medir() {
            larg = avisos.offsetWidth;
            jan = janela.clientWidth;
        }

        // modo normal: a placa de vídeo move a faixa; aqui só se encadeia uma volta na outra
        function ciclo() {
            var proximo = proximoGrupoNoticias();
            if (proximo) avisos.textContent = proximo;
            medir();
            if (!larg || !jan) { setTimeout(ciclo, 500); return; }   // ainda sem layout
            correr(avisos, jan, -larg, VELOCIDADE_TICKER_PX_S, ciclo);
        }

        // modo de reserva (TV muito antiga): move quadro a quadro
        function passo(agora) {
            if (x === null) {
                medir();
                x = jan;
            }

            var dt = ultimo ? Math.min(agora - ultimo, 250) : 0;
            ultimo = agora;

            x -= VELOCIDADE_TICKER_PX_S * dt / 1000;

            if (x < -larg) {            // terminou de passar: entra o próximo grupo
                var proximo = proximoGrupoNoticias();
                if (proximo) avisos.textContent = proximo;
                medir();
                x = jan;
            }

            aplicarTransform(avisos, "translate3d(" + x + "px,0,0)");
        }

        if (SUPORTA_TRANSICAO) {
            ciclo();
        } else {
            passos.push(passo);
        }
    }

    /* ---------- rolagem infinita ----------
       O cabeçalho da tabela fica parado e só as linhas rolam, sem parar.
       Para o ciclo ser perfeito, as linhas são duplicadas: quando a rolagem
       chega ao fim da primeira cópia, volta ao começo sem salto visível.
       O movimento é feito por transform (acelerado pela placa de vídeo),
       o que evita o "tremido" da rolagem comum em TVs antigas. */

    var infAtiva = false;
    var infPos = 0;
    var infPeriodo = 0;
    var infUltimo = 0;

    function alturaDisponivel(cont, thead) {
        var max = parseFloat(window.getComputedStyle(cont).maxHeight);
        if (isNaN(max)) max = window.innerHeight - 360;
        return max - 2 - (thead ? thead.offsetHeight : 0);
    }

    /* Mede as colunas a partir do conteúdo (como numa tabela normal) e fixa as
       larguras em pixels no cabeçalho e em todas as linhas. Assim as colunas
       ficam alinhadas e nenhum texto sai da célula. A coluna 6 ("Ações")
       fica com o que sobrar. */
    function aplicarLarguras(cont, thead) {
        var estilo = document.getElementById("larguraColunas");
        if (!estilo) {
            estilo = document.createElement("style");
            estilo.id = "larguraColunas";
            document.getElementsByTagName("head")[0].appendChild(estilo);
        }
        estilo.textContent = "";

        var m = document.createElement("table");
        m.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;" +
            "table-layout:auto;border-collapse:separate;border-spacing:0;width:" +
            Math.max(cont.clientWidth - 8, 300) + "px";
        m.appendChild(thead.cloneNode(true));

        var mb = document.createElement("tbody");
        var i, j;
        for (i = 0; i < tbody.rows.length; i++) mb.appendChild(tbody.rows[i].cloneNode(true));
        m.appendChild(mb);
        document.body.appendChild(m);

        var cels = m.rows[0].cells;
        var larguras = [];
        for (j = 0; j < cels.length; j++) larguras.push(cels[j].getBoundingClientRect().width);
        document.body.removeChild(m);

        var cols = [1, 2, 3, 5, 7];
        var regras = "";
        for (j = 0; j < cols.length; j++) {
            var w = larguras[cols[j] - 1];
            if (w > 0) {
                regras += "body.infinita #agenda th:nth-child(" + cols[j] + "), " +
                    "body.infinita #agenda td:nth-child(" + cols[j] + ") { width: " +
                    (Math.ceil(w * 100) / 100) + "px; }\n";
            }
        }
        estilo.textContent = regras;
    }

    function moverTbody(y) {
        var v = "translate3d(0," + (-y) + "px,0)";
        tbody.style.webkitTransform = v;
        tbody.style.transform = v;
    }

    function montarInfinita() {
        if (MODO_TABELA !== "infinita") return;

        var cont = document.querySelector(".table-container");
        var tabela = document.getElementById("agenda");
        var thead = cont ? cont.querySelector("thead") : null;
        if (!cont || !tabela) return;

        infAtiva = false;
        infPos = 0;
        infPeriodo = 0;
        infUltimo = 0;
        moverTbody(0);
        tabela.style.height = "auto";

        var n = tbody.rows.length;
        if (!n || !thead) return;

        aplicarLarguras(cont, thead);

        var disp = alturaDisponivel(cont, thead);
        var total = tbody.rows[n - 1].offsetTop + tbody.rows[n - 1].offsetHeight - tbody.rows[0].offsetTop;

        if (total <= disp + 2) return;   // tudo cabe na tela: não precisa rolar

        // Só a área abaixo do cabeçalho rola: o corpo da tabela é movido por
        // transform e o cabeçalho, opaco e por cima, esconde as linhas que
        // passam por baixo dele.
        tabela.style.height = (thead.offsetHeight + disp) + "px";

        var i, j;

        // Número ímpar de linhas: acrescenta uma linha em branco (separando o fim
        // do começo da lista) para o zebrado não inverter na emenda.
        if (n % 2 === 1) {
            var sep = document.createElement("tr");
            for (j = 0; j < 7; j++) {
                var td = document.createElement("td");
                td.textContent = "\u00a0";
                sep.appendChild(td);
            }
            tbody.appendChild(sep);
            n += 1;
        }

        var originais = [];
        for (i = 0; i < n; i++) originais.push(tbody.rows[i]);

        for (i = 0; i < cache.length; i++) cache[i]._clones = [];

        for (i = 0; i < n; i++) {
            var copia = originais[i].cloneNode(true);
            tbody.appendChild(copia);
            if (cache[i]) cache[i]._clones.push(copia);
        }

        infPeriodo = tbody.rows[n].offsetTop - tbody.rows[0].offsetTop;
        infAtiva = infPeriodo > 0;
    }

    function quadroInf(agora) {
        if (infAtiva) {
            var dt = infUltimo ? Math.min(agora - infUltimo, 250) : 0;
            infUltimo = agora;

            infPos += VELOCIDADE_PX_S * dt / 1000;
            if (infPos >= infPeriodo) infPos -= infPeriodo;
            moverTbody(infPos);
        }
    }

    /* ---------- pelo menos LINHAS_MINIMAS linhas visíveis ----------
       Se a tela for baixa, o cabeçalho, os cartões, as letras e os
       espaçamentos encolhem juntos, na proporção necessária, até que as
       linhas mais altas caibam na área da tabela (sem passar de ESCALA_MINIMA). */

    function px(v, f) {
        return (Math.round(v * f * 10) / 10) + "px";
    }

    function aplicarEscalaTV(f) {
        var est = document.getElementById("escalaTV");
        if (!est) {
            est = document.createElement("style");
            est.id = "escalaTV";
            document.getElementsByTagName("head")[0].appendChild(est);
        }

        if (f >= 0.999) {
            est.textContent = "";
            return;
        }

        var r = "";
        r += "body.tv header{min-height:" + px(90, f) + "}";
        r += "body.tv .logo{height:" + px(64, f) + "}";
        r += "body.tv .logo-area h1{font-size:" + px(34, f) + "}";
        r += "body.tv .logo-area p{font-size:" + px(16, f) + "}";
        r += "body.tv #barraEvento{height:" + px(50, f) + ";font-size:" + px(35, f) + "}";
        r += "body.tv .dashboard{padding:" + px(25, f) + " " + px(30, f) + "}";
        r += "body.tv .stat-card{padding:" + px(22, f) + " " + px(28, f) + "}";
        r += "body.tv .stat-card.card-gradient{padding:" + px(20, f) + "}";
        r += "body.tv .stat-label,body.tv .stat-label2{font-size:" + px(28, f) + "}";
        r += "body.tv .stat-value-lg{font-size:" + px(68, f) + "}";
        r += "body.tv .table-container{margin:0 " + px(30, f) + " " + px(20, f) + "}";
        r += "body.tv th{padding:" + px(18, f) + ";font-size:" + px(26, f) + "}";
        r += "body.tv td{padding:" + px(16, f) + ";font-size:" + px(40, f) + "}";
        r += "body.tv footer{height:" + px(55, f) + "}";
        r += "body.tv #avisos{font-size:" + px(30, f) + "}";
        r += "body.tv #erroTela{bottom:" + px(55, f) + ";font-size:" + px(26, f) + "}";
        est.textContent = r;
    }

    // A tabela ocupa todo o espaço entre os cartões e o rodapé.
    function ajustarAlturaContainer(cont) {
        var rodape = document.querySelector("footer");
        var topo = cont.getBoundingClientRect().top;
        var base = rodape ? rodape.getBoundingClientRect().top : window.innerHeight;
        var h = Math.max(base - topo - 16, 120);
        cont.style.maxHeight = h + "px";
    }

    function maiorSoma(alturas, k) {
        var melhor = 0;
        for (var i = 0; i + k <= alturas.length; i++) {
            var s = 0;
            for (var j = 0; j < k; j++) s += alturas[i + j];
            if (s > melhor) melhor = s;
        }
        return melhor;
    }

    function ajustarEscala() {
        var cont = document.querySelector(".table-container");
        var thead = cont ? cont.querySelector("thead") : null;
        if (!cont || !thead) return;

        var f = 1;
        var guarda = 0;

        while (guarda < 20) {
            guarda++;
            aplicarEscalaTV(f);
            ajustarAlturaContainer(cont);
            if (MODO_TABELA === "infinita") aplicarLarguras(cont, thead);

            var n = tbody.rows.length;
            if (!n) return;

            var alturas = [];
            var total = 0;
            for (var i = 0; i < n; i++) {
                var h = tbody.rows[i].offsetHeight;
                alturas.push(h);
                total += h;
            }

            var disp = alturaDisponivel(cont, thead);
            var minimas = Math.min(LINHAS_MINIMAS, n);

            if (total <= disp + 2 || maiorSoma(alturas, minimas) <= disp || f <= ESCALA_MINIMA) return;

            f = Math.round((f - 0.05) * 100) / 100;
            if (f < ESCALA_MINIMA) f = ESCALA_MINIMA;
        }
    }

    /* ---------- início ---------- */

    // Redesenhar mede e refaz tudo; durante um redimensionamento o evento
    // dispara dezenas de vezes, então espera a tela "assentar".
    var timerResize = null;
    function aoRedimensionar() {
        clearTimeout(timerResize);
        timerResize = setTimeout(function () { desenhar(cache); }, 250);
    }

    iniciarTicker();
    iniciarBarra();
    carregar();
    carregarNoticias();

    setInterval(carregar, INTERVALO_MS);
    setInterval(atualizarBarra, 5000);

    if (MODO_TABELA === "infinita") {
        passos.push(quadroInf);
        window.addEventListener("resize", aoRedimensionar);
        if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
            document.fonts.ready.then(function () { if (cache.length) desenhar(cache); });
        }
    } else if (MODO_TABELA === "continua") {
        passos.push(quadro);
    } else if (MODO_TABELA === "carrossel") {
        setInterval(proximaPagina, TEMPO_PAGINA_MS);
        window.addEventListener("resize", aoRedimensionar);
    } else {
        // Sem rolagem automática: deixa a tabela rolável à mão (ex.: controle com ponteiro)
        var tabelaCont = document.querySelector(".table-container");
        if (tabelaCont) tabelaCont.style.overflowY = "auto";
    }

    setInterval(carregarNoticias, 10 * 60 * 1000);

    raf(laco);

    // Recarrega a página a cada 15 minutos (evita acúmulo de memória na TV)
    setInterval(function () {
        window.location.replace(window.location.href);
    }, 15 * 60 * 1000);
})();
