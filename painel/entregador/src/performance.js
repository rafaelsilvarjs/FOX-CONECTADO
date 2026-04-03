import { useEffect, useMemo, useState } from "react";
import { API_URL } from "./config";

const LOGO_URL = `${process.env.PUBLIC_URL}/logo192.png`;
const PERFORMANCE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1p4w8hJcq7lqIMsB75h51SPe3zNcjSNjYVdR1KS9w8BA/export?format=csv&gid=0";

const BLOCOS_NIVEL = {
  "SUPER FOX": {
    titulo: "AGENDA - SUPERFOX - Abertura da agenda: 09h00",
    intro: "Parabens por ter alcancado o SuperFOX, continue com os pontos chaves:",
    aviso: [
      "Essa avaliacao serve apenas para manter sua prioridade na agenda.",
      "Nao e cobranca - sao orientacoes para melhorar seu desempenho.",
      "Voce e prestador de servico e tem autonomia total."
    ],
    rodape: "Nos verificamos tambem: Compromisso com as agendas; Media de produtividade",
    fechamento: "Continue firme!"
  },
  OURO: {
    titulo: "AGENDA - OURO - Abertura da agenda: 09h10",
    intro: "Busque evoluir para SuperFox e tenha beneficios exclusivos!",
    aviso: [
      "Essa avaliacao serve apenas para manter sua prioridade na agenda.",
      "Voce e prestador de servico e tem autonomia total."
    ],
    rodape: "Nos verificamos tambem: Compromisso com as agendas; Media de produtividade",
    fechamento: ""
  },
  "AGENDA BASE": {
    titulo: "AGENDA - AGENDA BASE - Abertura da agenda: 09h20",
    intro: "Busque evoluir para SuperFox e tenha beneficios exclusivos!",
    aviso: [
      "Essa avaliacao serve apenas para manter sua prioridade na agenda.",
      "Nao e cobranca - sao orientacoes para melhorar seu desempenho.",
      "Voce e prestador de servico e tem autonomia total."
    ],
    rodape: "Nos verificamos tambem: Compromisso com as agendas; Media de produtividade",
    fechamento: "Continue firme!"
  }
};

const REGRAS = [
  { label: "AR (rotas aceitas)", valor: "MAIOR OU IGUAL A 95%", classe: "ar" },
  { label: "CAA (cancelamento apos aceite)", valor: "MENOR OU IGUAL A 1%", classe: "caa" },
  { label: "OVERTIME (atraso na entrega)", valor: "1%", classe: "overtime" }
];

function normalizarCabecalho(valor = "") {
  return String(valor)
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizarNivel(valor = "") {
  const chave = String(valor).trim().toUpperCase().replace(/\s+/g, " ");
  if (chave === "SUPERFOX") return "SUPER FOX";
  return chave;
}

function normalizarNumeroPlanilha(valor = "") {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return 0;
  const numero = Number(bruto.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  return Number.isFinite(numero) ? numero : 0;
}

function formatarPercentual(valor) {
  const numero = Number(valor || 0);
  if (!Number.isFinite(numero)) return "0%";

  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: Number.isInteger(numero) ? 0 : 1,
    maximumFractionDigits: 1
  }).format(numero)}%`;
}

function parseCsvLine(line) {
  const values = [];
  let atual = "";
  let emAspas = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === "\"") {
      if (emAspas && line[i + 1] === "\"") {
        atual += "\"";
        i += 1;
      } else {
        emAspas = !emAspas;
      }
      continue;
    }

    if (char === "," && !emAspas) {
      values.push(atual);
      atual = "";
      continue;
    }

    atual += char;
  }

  values.push(atual);
  return values.map((item) => item.trim());
}

function parseCsv(texto = "") {
  return texto
    .split(/\r?\n/)
    .filter((linha) => linha.trim())
    .map((linha) => parseCsvLine(linha));
}

async function carregarViaApi(cpf) {
  const resposta = await fetch(`${API_URL}/entregadores/${cpf}/performance`);
  const contentType = resposta.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error("Resposta da API nao veio em JSON.");
  }

  const dados = await resposta.json();
  if (!resposta.ok) {
    throw new Error(dados.error || "Nao foi possivel carregar a performance.");
  }

  return dados.performance || null;
}

async function carregarViaPlanilha(cpf) {
  const resposta = await fetch(PERFORMANCE_CSV_URL);
  if (!resposta.ok) {
    throw new Error("Nao foi possivel acessar a planilha de performance.");
  }

  const csv = await resposta.text();
  const linhas = parseCsv(csv);
  if (linhas.length < 2) {
    throw new Error("A planilha de performance esta vazia.");
  }

  const headers = linhas[0].map((item) => normalizarCabecalho(item));
  const registros = linhas.slice(1).map((colunas) => {
    const registro = {};

    headers.forEach((header, indice) => {
      registro[header] = String(colunas[indice] || "").trim();
    });

    return {
      cpf: String(registro.CPF || "").replace(/\D/g, "").slice(0, 11),
      nome: String(registro.NOME || "").trim(),
      tsh: normalizarNumeroPlanilha(registro.TSH),
      ar: normalizarNumeroPlanilha(registro.AR),
      caa: normalizarNumeroPlanilha(registro.CAA),
      overtime: normalizarNumeroPlanilha(registro.OVERTIME),
      corridas: normalizarNumeroPlanilha(registro.CORRIDAS),
      nivel: normalizarNivel(registro.NIVEL)
    };
  });

  return registros.find((item) => item.cpf === cpf) || null;
}

function Performance({ entregador, onBack }) {
  const [performance, setPerformance] = useState(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ativo = true;

    const carregar = async () => {
      try {
        setLoading(true);
        setErro("");

        let dados = null;

        try {
          dados = await carregarViaApi(entregador.cpf);
        } catch (_) {
          dados = await carregarViaPlanilha(entregador.cpf);
        }

        if (!dados) {
          throw new Error("Performance nao encontrada para este CPF.");
        }

        if (ativo) {
          setPerformance(dados);
        }
      } catch (err) {
        if (ativo) {
          setErro(err.message);
        }
      } finally {
        if (ativo) {
          setLoading(false);
        }
      }
    };

    carregar();

    return () => {
      ativo = false;
    };
  }, [entregador.cpf]);

  const nivel = useMemo(() => normalizarNivel(performance?.nivel || ""), [performance?.nivel]);
  const bloco = BLOCOS_NIVEL[nivel] || BLOCOS_NIVEL["AGENDA BASE"];

  return (
    <div className="performance-page">
      <img className="fox-watermark performance-watermark" src={LOGO_URL} alt="" aria-hidden="true" />

      <div className="performance-shell">
        <div className="performance-topbar">
          <h1>Bem-vindo a Plataforma Oficial do Entregador FoxLog!</h1>
          <button className="performance-exit" onClick={onBack}>
            Sair
          </button>
        </div>

        {loading ? (
          <div className="performance-loading">Carregando sua performance...</div>
        ) : erro ? (
          <div className="performance-error">{erro}</div>
        ) : (
          <>
            <section className="performance-level-box">
              <span>Agenda Atual:</span>
              <strong>{nivel || "AGENDA BASE"}</strong>
            </section>

            <h2 className="performance-name">Ola, {performance?.nome || entregador.nome}</h2>

            <section className="performance-metrics">
              <article className="performance-metric-card">
                <span>AR</span>
                <strong>{formatarPercentual(performance?.ar)}</strong>
              </article>
              <article className="performance-metric-card">
                <span>CAA</span>
                <strong>{formatarPercentual(performance?.caa)}</strong>
              </article>
              <article className="performance-metric-card">
                <span>OVERTIME</span>
                <strong>{formatarPercentual(performance?.overtime)}</strong>
              </article>
              <article className="performance-metric-card">
                <span>Tempo Online</span>
                <strong>{formatarPercentual(performance?.tsh)}</strong>
              </article>
            </section>

            <section className="performance-rule-box">
              <h3>{bloco.titulo}</h3>
              <p>{bloco.intro}</p>

              <ul className="performance-rules">
                {REGRAS.map((regra) => (
                  <li key={regra.label}>
                    <span className={`rule-label ${regra.classe}`}>{regra.label}</span>
                    <span className="rule-value">= {regra.valor}</span>
                  </li>
                ))}
              </ul>

              <div className="performance-warning">
                <strong>Lembrando que</strong>
                {bloco.aviso.map((linha) => (
                  <p key={linha}>{linha}</p>
                ))}
              </div>

              <p>{bloco.rodape}</p>
              {bloco.fechamento ? <p>{bloco.fechamento}</p> : null}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default Performance;
