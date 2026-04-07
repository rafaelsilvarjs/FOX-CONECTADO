import { useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "./config";

const REGIOES_ORDEM = ["Sao Paulo", "Rio de Janeiro", "Campinas"];

function lerArquivoComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function Disparo({ user, onBack, onGoToAtendimento, onGoToAcompanhamento }) {
  const logoUrl = `${process.env.PUBLIC_URL}/logo192.png`;
  const fileInputRef = useRef(null);
  const [regiao, setRegiao] = useState("Todos");
  const [hotZoneSelecionada, setHotZoneSelecionada] = useState("Todas");
  const [entregadores, setEntregadores] = useState([]);
  const [selecionados, setSelecionados] = useState([]);
  const [mensagem, setMensagem] = useState("");
  const [midia, setMidia] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function carregarBase() {
      const resposta = await fetch(`${API_URL}/entregadores`);
      const dados = await resposta.json();
      const lista = dados.entregadores || [];
      setEntregadores(lista);
      setSelecionados(lista.map((item) => item.cpf));
    }

    carregarBase();
  }, []);

  const regioesDisponiveis = useMemo(() => {
    const detectadas = [...new Set(entregadores.map((item) => String(item.regiao || item.cidade || "").trim()).filter(Boolean))];
    const ordenadas = [
      ...REGIOES_ORDEM.filter((item) => detectadas.includes(item)),
      ...detectadas.filter((item) => !REGIOES_ORDEM.includes(item)).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }))
    ];

    return ["Todos", ...ordenadas];
  }, [entregadores]);

  const entregadoresDaRegiao = useMemo(() => {
    if (regiao === "Todos") {
      return entregadores;
    }

    return entregadores.filter((item) => String(item.regiao || item.cidade || "").trim() === regiao);
  }, [entregadores, regiao]);

  const hotZonesDisponiveis = useMemo(() => {
    if (regiao === "Todos") {
      return ["Todas"];
    }

    const zonas = [...new Set(entregadoresDaRegiao.map((item) => String(item.hotZone || "").trim()).filter(Boolean))];
    return ["Todas", ...zonas.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }))];
  }, [entregadoresDaRegiao, regiao]);

  const entregadoresFiltrados = useMemo(() => {
    const base = hotZoneSelecionada === "Todas"
      ? entregadoresDaRegiao
      : entregadoresDaRegiao.filter((item) => String(item.hotZone || "").trim() === hotZoneSelecionada);
    return base;
  }, [entregadoresDaRegiao, hotZoneSelecionada]);

  useEffect(() => {
    if (!hotZonesDisponiveis.includes(hotZoneSelecionada)) {
      setHotZoneSelecionada("Todas");
    }
  }, [hotZonesDisponiveis, hotZoneSelecionada]);

  useEffect(() => {
    if (!regioesDisponiveis.includes(regiao)) {
      setRegiao("Todos");
    }
  }, [regiao, regioesDisponiveis]);

  useEffect(() => {
    setSelecionados(entregadoresFiltrados.map((item) => item.cpf));
  }, [regiao, hotZoneSelecionada, entregadoresFiltrados]);

  const alternarCpf = (cpf) => {
    setSelecionados((atual) =>
      atual.includes(cpf) ? atual.filter((item) => item !== cpf) : [...atual, cpf]
    );
  };

  const selecionarArquivo = async (file) => {
    if (!file) return;

    const tipo = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : "file";

    const dataUrl = await lerArquivoComoDataUrl(file);
    setMidia({
      type: tipo,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      dataUrl
    });
    setStatus("");
  };

  const enviarDisparo = async () => {
    try {
      setLoading(true);
      setStatus("");

      const cpfsVisiveis = new Set(entregadoresFiltrados.map((item) => item.cpf));
      const selecionadosNoFiltro = selecionados.filter((cpf) => cpfsVisiveis.has(cpf));
      const destinos = selecionadosNoFiltro.map((cpf) => ({ cpf }));

      const resposta = await fetch(`${API_URL}/disparo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atendente: user.email,
          cpfs: destinos,
          mensagem,
          media: midia
        })
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(dados.error || "Nao foi possivel enviar o disparo.");
      }

      setStatus(`Mensagem enviada para ${dados.total} entregadores.`);
      setMensagem("");
      setMidia(null);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mass-page">
      <div className="mass-shell">
        <div className="mass-header">
          <div className="brand with-logo">
            <img className="brand-logo" src={logoUrl} alt="FoxLog" />
            <div>
              <strong>Disparo em massa</strong>
              <span>Selecione a regiao, escolha os entregadores e envie a mesma mensagem.</span>
            </div>
          </div>

          <div className="mass-header-actions">
            <button className="secondary-button" onClick={onGoToAtendimento}>
              Ir para atendimento
            </button>
            {user.role === "admin" ? (
              <button className="secondary-button" onClick={onGoToAcompanhamento}>
                Ir para administrador
              </button>
            ) : null}
            <button className="ghost-button" onClick={onBack}>
              Voltar
            </button>
          </div>
        </div>

        <div className="mass-grid">
          <section className="mass-panel mass-panel-base">
            <div className="mass-panel-head">
              <div>
                <strong>Base da planilha</strong>
                <div className="mass-subtitle">Contatos ativos do aplicativo de atendimento divididos pela cidade.</div>
              </div>
              <div className="mass-count-badge">{entregadoresFiltrados.length}</div>
            </div>

            <div className="mass-toolbar">
              {regioesDisponiveis.map((item) => (
                <button
                  key={item}
                  className={item === regiao ? "primary-button" : "ghost-button"}
                  onClick={() => setRegiao(item)}
                >
                  {item}
                </button>
              ))}

              {regiao !== "Todos" ? (
                <label className="field compact-field mass-hotzone-field">
                  <span>Hot zone</span>
                  <select value={hotZoneSelecionada} onChange={(e) => setHotZoneSelecionada(e.target.value)}>
                    {hotZonesDisponiveis.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div className="mass-list">
              {entregadoresFiltrados.map((item) => (
                <button
                  type="button"
                  key={item.cpf}
                  className={`mass-card ${selecionados.includes(item.cpf) ? "selected" : ""}`}
                  onClick={() => alternarCpf(item.cpf)}
                >
                  <span className={`mass-check ${selecionados.includes(item.cpf) ? "checked" : ""}`} aria-hidden="true">
                    {selecionados.includes(item.cpf) ? "✓" : ""}
                  </span>
                  <div className="mass-card-body">
                    <div className="mass-card-title-row">
                      <strong>{item.nome}</strong>
                      <span className="mass-city-chip">{item.cidade || item.regiao || "Sem cidade"}</span>
                    </div>
                    <div className="mass-card-meta">CPF: {item.cpf}</div>
                    <div className="mass-card-meta">Celular: {item.telefone || item.celular || "Nao informado"}</div>
                    <div className="mass-card-meta">Hot zone: {item.hotZone || "Nao informada"}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="mass-panel mass-panel-compose">
            <div className="mass-compose-head">
              <div>
                <strong>Mensagem do disparo</strong>
                <p className="queue-meta">Atendente: {user.nome}</p>
              </div>
              <div className="mass-count-badge mass-count-badge-soft">
                {selecionados.filter((cpf) => entregadoresFiltrados.some((item) => item.cpf === cpf)).length}
              </div>
            </div>

            <div className="mass-compose-body">
              <div className="mass-attachment-bar">
                <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}>
                  Anexar imagem / video / arquivo
                </button>
                {midia ? (
                  <button type="button" className="ghost-button" onClick={() => setMidia(null)}>
                    Remover anexo
                  </button>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    try {
                      await selecionarArquivo(file);
                    } catch (error) {
                      setStatus(error.message);
                    } finally {
                      e.target.value = "";
                    }
                  }}
                />
              </div>

              {midia ? (
                <div className="mass-attachment-preview">
                  <strong>{midia.name || "Anexo selecionado"}</strong>
                  <div className="queue-meta">{midia.type === "image" ? "Imagem" : midia.type === "video" ? "Video" : "Arquivo"}</div>
                </div>
              ) : null}

              <label className="field mass-message-field">
                <span>Mensagem</span>
                <textarea
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  placeholder="Digite a mensagem que sera enviada para todos os selecionados..."
                />
              </label>
            </div>

            <div className="mass-compose-footer">
              <button
                className="secondary-button mass-submit-button"
                onClick={enviarDisparo}
                disabled={loading || (!mensagem.trim() && !midia) || selecionados.length === 0}
              >
                {loading ? "Enviando..." : `Enviar para ${selecionados.filter((cpf) => entregadoresFiltrados.some((item) => item.cpf === cpf)).length} entregadores`}
              </button>

              {status ? <div className="helper-text">{status}</div> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Disparo;
