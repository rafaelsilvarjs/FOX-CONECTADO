import { useState } from "react";
import { API_URL } from "./config";

function Login({ setUser, setTela }) {
  const logoUrl = `${process.env.PUBLIC_URL}/logo192.png`;
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const entrar = async () => {
    try {
      setLoading(true);
      setError("");

      const resposta = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha })
      });

      if (!resposta.ok) {
        let mensagem = "Email ou senha invalidos.";
        try {
          const erro = await resposta.json();
          mensagem = erro.error || mensagem;
        } catch (_) {
        }
        throw new Error(mensagem);
      }

      const user = await resposta.json();
      setUser(user);
      setTela("home");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <img className="fox-watermark" src={logoUrl} alt="" aria-hidden="true" />
      <div className="login-card">
        <div className="brand with-logo">
          <img className="brand-logo" src={logoUrl} alt="FoxLog" />
          <div>
            <strong>FoxLog Connect</strong>
            <span>Painel do atendente para fila, atendimento e cadastro dos entregadores.</span>
          </div>
        </div>

        <label className="field">
          <span>Email</span>
          <input
            placeholder="seuemail@foxlog.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <input
            placeholder="Digite sua senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </label>

        <button className="primary-button" onClick={entrar} disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>

        {error ? <div className="error-text">{error}</div> : null}
        <div className="helper-text">
          O acesso do painel e validado pela planilha de login com email, senha e status liberado.
        </div>
      </div>
    </div>
  );
}

export default Login;
