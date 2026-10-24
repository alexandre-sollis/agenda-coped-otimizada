/* =====================================================
   agenda-utils.js — funções compartilhadas pela agenda (app.js)
   e pelo modo TV (tv.js).

   Escrito em JavaScript antigo (ES5, sem módulos) para rodar também
   em navegadores de TV. Antes, estas regras estavam copiadas nos dois
   arquivos e já tinham divergido (ordem dos eventos, leitura de datas
   e horários, "próximo evento"). Agora existe uma única versão.
===================================================== */
(function (root) {
    "use strict";

    var U = {};

    /* ---------- configurações comuns ---------- */

    U.RSS_G1 = "https://g1.globo.com/rss/g1/educacao/";
    // troque por "https://g1.globo.com/rss/g1/" para notícias gerais

    U.PALAVRAS_BLOQUEADAS = ["grito", "ameaça", "assassin", "estupro", "tiroteio", "morto", "morre"];

    U.manchetePermitida = function (titulo) {
        var t = String(titulo).toLowerCase();
        for (var i = 0; i < U.PALAVRAS_BLOQUEADAS.length; i++) {
            if (t.indexOf(U.PALAVRAS_BLOQUEADAS[i]) !== -1) return false;
        }
        return true;
    };

    /* ---------- datas e horas ---------- */

    U.hojeZero = function (base) {
        var h = base ? new Date(base.getTime()) : new Date();
        h.setHours(0, 0, 0, 0);
        return h;
    };

    // "10/11", "10/11/26" ou "10/11/2026" -> Date (sem ano = ano atual)
    U.converterData = function (data) {
        if (!data) return null;
        var p = String(data).trim().split("/");
        var d, m, a;
        if (p.length === 2) {
            d = p[0]; m = p[1]; a = new Date().getFullYear();
        } else if (p.length === 3) {
            d = p[0]; m = p[1]; a = p[2];
        } else {
            return null;
        }
        d = parseInt(d, 10); m = parseInt(m, 10); a = parseInt(a, 10);
        if (isNaN(d) || isNaN(m) || isNaN(a)) return null;
        if (a < 100) a += 2000;
        return new Date(a, m - 1, d);
    };

    // aceita "08:30", "8h30", "8h", "8"
    U.lerHora = function (texto) {
        var m = String(texto || "").match(/(\d{1,2})\s*(?:[:hH]\s*(\d{2}))?/);
        if (!m) return null;
        return { h: parseInt(m[1], 10), min: m[2] ? parseInt(m[2], 10) : 0 };
    };

    // Só encurta para "dd/mm" quando o ano é o atual. Antes o ano era sempre
    // cortado, e ao salvar um evento de outro ano ele era gravado sem o ano
    // (e passava a valer para o ano atual).
    U.formatarDataCurta = function (data) {
        if (!data) return "";
        var p = String(data).trim().split("/");
        if (p.length === 3 && parseInt(p[2], 10) === new Date().getFullYear()) {
            return p[0] + "/" + p[1];
        }
        return String(data).trim();
    };

    U.dd_mm = function (d) {
        return (d.getDate() < 10 ? "0" : "") + d.getDate() + "/" +
            (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1);
    };

    U.dataMaisDias = function (d, dias) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);
    };

    U.formatarTempo = function (ms) {
        if (ms < 0) ms = 0;
        var total = Math.floor(ms / 1000);
        var dias = Math.floor(total / 86400);
        var horas = Math.floor((total % 86400) / 3600);
        var minutos = Math.floor((total % 3600) / 60);
        var segundos = total % 60;
        if (dias > 0) return dias + "d " + horas + "h " + minutos + "min";
        if (horas > 0) return horas + "h " + minutos + "min";
        return minutos + "min " + segundos + "s";
    };

    /* ---------- período (manhã / tarde / noite / integral) ---------- */

    // devolve a lista de classes: ["manha"], ["tarde", "noite"], ...
    U.classesPeriodo = function (periodo) {
        var per = String(periodo || "").toLowerCase();
        var r = [];
        if (per.indexOf("manh") !== -1 || per.indexOf("matutino") !== -1) r.push("manha");
        if (per.indexOf("tarde") !== -1 || per.indexOf("vespertino") !== -1) r.push("tarde");
        if (per.indexOf("noite") !== -1 || per.indexOf("noturno") !== -1) r.push("noite");
        if (per.indexOf("integral") !== -1) r.push("integral");
        return r;
    };

    /* ---------- ordenação (hoje, futuros, passados) ----------
       Cada item precisa de: inicio, fim, horario e _i (posição original,
       usada como desempate para a ordem ser sempre a mesma). */

    function chaveHoraDia(item) {   // hoje: sem horário (dia inteiro) vem primeiro
        var h = U.lerHora(item.horario);
        return h ? h.h * 60 + h.min : -1;
    }

    function chaveHora(item) {      // outros dias: sem horário vem por último
        var h = U.lerHora(item.horario);
        return h ? h.h * 60 + h.min : 9999;
    }

    U.ordenar = function (lista, hoje) {
        lista.sort(function (a, b) {
            var iA = U.converterData(a.inicio), fA = U.converterData(a.fim);
            var iB = U.converterData(b.inicio), fB = U.converterData(b.fim);

            var hojeA = iA && fA && hoje >= iA && hoje <= fA;
            var hojeB = iB && fB && hoje >= iB && hoje <= fB;
            if (hojeA && !hojeB) return -1;
            if (!hojeA && hojeB) return 1;

            if (hojeA && hojeB) {
                var kA = chaveHoraDia(a), kB = chaveHoraDia(b);
                if (kA !== kB) return kA - kB;
                var dI = iA.getTime() - iB.getTime();
                if (dI !== 0) return dI;
                return a._i - b._i;
            }

            var futA = iA && iA >= hoje;
            var futB = iB && iB >= hoje;
            if (futA && !futB) return -1;
            if (!futA && futB) return 1;

            var dif = (iA ? iA.getTime() : 0) - (iB ? iB.getTime() : 0);
            if (dif !== 0) return dif;

            var dh = chaveHora(a) - chaveHora(b);
            if (dh !== 0) return dh;

            return a._i - b._i;
        });
    };

    /* ---------- próximo evento ----------
       É o primeiro da lista que ainda não terminou:
       - com horário: a próxima ocorrência (hoje, se ainda não passou;
         senão o próximo dia do período);
       - sem horário: vale desde o início do dia e durante todo o período. */

    function proximaOcorrencia(it, agora, hoje) {
        var dIni = U.converterData(it.inicio);
        if (!dIni) return null;
        var dFim = U.converterData(it.fim) || dIni;
        var hora = U.lerHora(it.horario);
        var base, quando;

        if (!hora) {
            if (dFim < hoje) return null;
            base = dIni > hoje ? dIni : hoje;
            return { quando: base, temHora: false };
        }

        base = dIni > hoje ? dIni : (dFim >= hoje ? hoje : null);
        if (!base) return null;

        quando = new Date(base.getTime());
        quando.setHours(hora.h, hora.min, 0, 0);

        if (quando < agora) {
            var amanha = U.dataMaisDias(hoje, 1);
            if (dFim < amanha) return null;
            quando = new Date(amanha.getTime());
            quando.setHours(hora.h, hora.min, 0, 0);
        }

        return { quando: quando, temHora: true };
    }

    // Devolve null ou { item, quando, temHora, ms, texto }.
    // Itens precisam de: inicio, fim, horario, acao.
    U.proximoEvento = function (lista, agora) {
        var hoje = U.hojeZero(agora);
        var amanha = U.dataMaisDias(hoje, 1).getTime();
        var melhor = null;
        var menor = Infinity;

        for (var i = 0; i < lista.length; i++) {
            var oc = proximaOcorrencia(lista[i], agora, hoje);
            if (!oc) continue;
            var t = oc.quando.getTime();
            if (t < menor) {            // em empate, vale o primeiro da lista
                menor = t;
                melhor = { item: lista[i], quando: oc.quando, temHora: oc.temHora };
            }
        }

        if (!melhor) return null;

        var partes = [melhor.item.acao];
        var ehHoje = melhor.quando.getTime() < amanha;
        if (melhor.temHora) {
            if (!ehHoje) partes.push(U.dd_mm(melhor.quando));
            partes.push(melhor.item.horario);
        } else {
            partes.push(ehHoje ? "hoje" : U.dd_mm(melhor.quando));
        }

        melhor.ms = menor - agora.getTime();
        melhor.texto = partes.join(" \u2022 ");
        return melhor;
    };

    root.AgendaUtil = U;
})(window);
