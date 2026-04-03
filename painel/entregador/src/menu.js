import { useEffect, useState } from "react";
import { API_URL } from "./config";

const PERFORMANCE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1p4w8hJcq7lqIMsB75h51SPe3zNcjSNjYVdR1KS9w8BA/export?format=csv&gid=0";

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

function normalizarNivel(valor = "") {
  const chave = String(valor).trim().toUpperCase().replace(/\s+/g, " ");
  if (chave === "SUPERFOX") return "SUPER FOX";
  return chave;
}

async function buscarNivel(cpf) {
  try {
    const resposta = await fetch(`${API_URL}/entregadores/${cpf}/performance`);
    const contentType = resposta.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const dados = await resposta.json();
      return normalizarNivel(dados.performance?.nivel || "");
    }
  } catch (_) {
  }

  try {
    const resposta = await fetch(PERFORMANCE_CSV_URL);
    const csv = await resposta.text();
    const linhas = parseCsv(csv);
    const headers = linhas[0].map((item) => normalizarCabecalho(item));
    const indiceCpf = headers.indexOf("CPF");
    const indiceNivel = headers.indexOf("NIVEL");

    for (const linha of linhas.slice(1)) {
      const cpfLinha = String(linha[indiceCpf] || "").replace(/\D/g, "").slice(0, 11);
      if (cpfLinha === cpf) {
        return normalizarNivel(linha[indiceNivel] || "");
      }
    }
  } catch (_) {
  }

  return "";
}

function Menu({ entregador, setTela }) {
  const logoUrl = `${process.env.PUBLIC_URL}/logo192.png`;
  const [nivel, setNivel] = useState("");

  useEffect(() => {
    let ativo = true;

    buscarNivel(entregador.cpf).then((valor) => {
      if (ativo) {
        setNivel(valor);
      }
    });

    return () => {
      ativo = false;
    };
  }, [entregador.cpf]);

  return (
    <div className="deliverer-page">
      <img className="fox-watermark" src={logoUrl} alt="" aria-hidden="true" />
      <div className="deliverer-card spotlight">
        <div className="deliverer-brand with-logo">
          <img className="deliverer-logo" src={logoUrl} alt="FoxLog" />
          <div>
            <strong>FoxLog Connect</strong>
            <span>{entregador.nome}</span>
            <span>Hot zone: {entregador.hotZone || "-"}</span>
            <span>Nivel: {nivel || "Carregando..."}</span>
          </div>
        </div>

        <div className="deliverer-menu cards">
          <button className="menu-tile support" onClick={() => setTela("chat")}>
            <strong>Suporte</strong>
            <span>Converse com a operacao e acompanhe o atendimento.</span>
          </button>
          <button className="menu-tile performance" onClick={() => setTela("performance")}>
            <strong>Performance</strong>
            <span>Veja AR, CAA, overtime, tempo online e sua agenda atual.</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default Menu;
