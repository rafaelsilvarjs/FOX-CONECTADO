import { useState } from "react";
import { API_URL } from "./config";

function Login({ setEntregador, setTela }) {
  const logoUrl = `${process.env.PUBLIC_URL}/logo192.png`;
  const [form, setForm] = useState({
    cpf: ""
  });
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  const atualizarCampo = (campo, valor) => {
    if (campo === "cpf") {
      setForm((atual) => ({ ...atual, cpf: valor.replace(/\D/g, "").slice(0, 11) }));
      return;
    }

    setForm((atual) => ({ ...atual, [campo]: valor }));
  };

  const entrar = async () => {
    const cpf = form.cpf.replace(/\D/g, "").slice(0, 11);

    if (cpf.length !== 11) {
      setErro("Digite um CPF com 11 numeros.");
      return;
    }

    setErro("");

    try {
      setLoading(true);
      const resposta = await fetch(`${API_URL}/entregadores/entrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf })
      });

      const dados = await resposta.json();
      if (!resposta.ok) {
        throw new Error(dados.error || "Nao foi possivel entrar.");
      }

      setEntregador({
        nome: dados.entregador?.nome || "",
        cpf,
        telefone: dados.entregador?.telefone || "",
        celular: dados.entregador?.celular || dados.entregador?.telefone || "",
        regiao: dados.entregador?.regiao || "",
        cidade: dados.entregador?.cidade || dados.entregador?.regiao || "",
        hotZone: dados.entregador?.hotZone || ""
      });
      setTela("menu");
    } catch (err) {
      setErro(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="deliverer-page">
      <img className="fox-watermark" src={logoUrl} alt="" aria-hidden="true" />
      <div className="deliverer-card spotlight">
        <div className="deliverer-brand with-logo">
          <img className="deliverer-logo" src={logoUrl} alt="FoxLog" />
          <div>
            <strong>FoxLog Connect</strong>
          </div>
        </div>

        <label className="deliverer-field">
          <span>CPF</span>
          <input
            placeholder="Digite seu CPF"
            value={form.cpf}
            onChange={(e) => atualizarCampo("cpf", e.target.value)}
          />
        </label>

        <button className="deliverer-primary" onClick={entrar} disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <div className="deliverer-tip">Entre com um CPF ativo da planilha para acessar o atendimento.</div>

        {erro ? <div className="deliverer-error">{erro}</div> : null}
      </div>
    </div>
  );
}

export default Login;
