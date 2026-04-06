import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_URL } from "./config";

const REGIOES_SUPORTE = ["Sao Paulo", "Rio de Janeiro", "Campinas"];

function formatarHora(data) {
  if (!data) return "--:--";
  return new Date(data).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatarDataHora(data) {
  if (!data) return "--";
  return new Date(data).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatarDuracao(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) return "0:00";
  const minutos = Math.floor(segundos / 60);
  const resto = Math.floor(segundos % 60);
  return `${minutos}:${String(resto).padStart(2, "0")}`;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-svg">
      <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.68L9.54 5.98A1 1 0 0 0 8 6.82Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-svg">
      <path d="M8 6a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1Zm8 0a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1Z" fill="currentColor" />
    </svg>
  );
}

function AudioPlayer({ src }) {
  const audioRef = useRef(null);
  const [tocando, setTocando] = useState(false);
  const [duracao, setDuracao] = useState(0);
  const [tempoAtual, setTempoAtual] = useState(0);

  const alternar = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play().catch(() => {});
      return;
    }

    audio.pause();
  };

  return (
    <div className="audio-chip">
      <button type="button" className="audio-play" onClick={alternar}>
        {tocando ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="audio-track">
        <div className="audio-progress" style={{ width: `${duracao ? (tempoAtual / duracao) * 100 : 0}%` }} />
      </div>
      <div className="audio-time">{formatarDuracao(duracao - tempoAtual || duracao)}</div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => {
          setTocando(false);
          setTempoAtual(0);
        }}
        onLoadedMetadata={(e) => setDuracao(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setTempoAtual(e.currentTarget.currentTime || 0)}
      />
    </div>
  );
}

function MediaPreview({ media }) {
  if (!media?.dataUrl) return null;

  if (media.type === "image") {
    return <img className="message-media-image" src={media.dataUrl} alt={media.name || "Imagem enviada"} />;
  }

  if (media.type === "audio") {
    return <AudioPlayer src={media.dataUrl} />;
  }

  return null;
}

function Acompanhamento({ user, onBack, onGoToAtendimento }) {
  const logoUrl = `${process.env.PUBLIC_URL}/logo192.png`;
  const socket = useMemo(() => io(API_URL, { autoConnect: false }), []);
  const [atendentes, setAtendentes] = useState([]);
  const [ativos, setAtivos] = useState([]);
  const [erro, setErro] = useState("");
  const [conversaAberta, setConversaAberta] = useState(null);

  useEffect(() => {
    socket.connect();
    socket.emit("login", { id: user.email, tipo: "atendente" });

    const aoReceberPainel = (payload) => {
      setAtendentes(payload.atendentes || []);
      setAtivos(payload.ativos || []);
    };

    const aoReceberChat = ({ cpf, entregador, atendente, messages, history }) => {
      setConversaAberta({
        cpf,
        entregador,
        atendente,
        messages: messages || [],
        history: history || []
      });
    };

    const aoReceberMensagem = (nova) => {
      setConversaAberta((atual) => {
        if (!atual || atual.cpf !== nova.cpf) return atual;
        if (atual.messages.some((item) => item.id === nova.id)) return atual;
        return { ...atual, messages: [...atual.messages, nova] };
      });
    };

    const aoRemoverMensagem = ({ cpf, messageId }) => {
      setConversaAberta((atual) => {
        if (!atual || atual.cpf !== cpf) return atual;
        return { ...atual, messages: atual.messages.filter((item) => item.id !== messageId) };
      });
    };

    socket.on("painel_estado", aoReceberPainel);
    socket.on("chat_assigned", aoReceberChat);
    socket.on("msg", aoReceberMensagem);
    socket.on("msg_deleted", aoRemoverMensagem);
    socket.on("erro_atendimento", setErro);

    return () => {
      socket.off("painel_estado", aoReceberPainel);
      socket.off("chat_assigned", aoReceberChat);
      socket.off("msg", aoReceberMensagem);
      socket.off("msg_deleted", aoRemoverMensagem);
      socket.off("erro_atendimento", setErro);
      socket.disconnect();
    };
  }, [socket, user.email]);

  const acompanhar = (cpf) => {
    const conversa = ativos.find((item) => item.cpf === cpf);
    if (conversa) {
      setConversaAberta({
        cpf: conversa.cpf,
        entregador: conversa.entregador,
        atendente: conversa.atendente,
        messages: conversa.messages || [],
        history: []
      });
    }
    socket.emit("abrir_conversa", { email: user.email, cpf });
  };

  const assumir = (cpf) => {
    socket.emit("assumir_conversa", { email: user.email, cpf });
    window.setTimeout(() => {
      onGoToAtendimento?.(cpf);
    }, 180);
  };

  const alternarRegiao = (email, regiao, regioesAtuais) => {
    const proximo = regioesAtuais.includes(regiao)
      ? regioesAtuais.filter((item) => item !== regiao)
      : [...regioesAtuais, regiao];

    socket.emit("set_regioes_atendente", {
      admin: user.email,
      email,
      regioes: proximo
    });
  };

  const rotuloRole = (role) =>
    role === "admin" ? "Admin" : role === "operacao" ? "Operacao" : "Atendente";

  return (
    <div className="monitor-page">
      <div className="monitor-shell">
        <div className="mass-header">
          <div className="brand with-logo">
            <img className="brand-logo" src={logoUrl} alt="FoxLog" />
            <div>
              <strong>Acompanhamento Admin</strong>
              <span>Visao geral de atendentes, status e conversas simultaneas.</span>
            </div>
          </div>

          <button className="ghost-button" onClick={onBack}>
            Voltar
          </button>
        </div>

        {erro ? <div className="error-text">{erro}</div> : null}

        <div className="monitor-layout">
          <div className="monitor-grid">
            {atendentes.map((atendente) => (
              <section className="monitor-card" key={atendente.email}>
                <div className="monitor-head">
                  <div className="monitor-head-copy">
                    <strong>{atendente.nome}</strong>
                    <div className="queue-meta">{atendente.email}</div>
                  </div>
                </div>

                <div className="monitor-summary-row">
                  <span className="role-chip">{rotuloRole(atendente.role)}</span>
                  <span className={`status-badge ${atendente.online ? "online" : "offline"}`}>
                    {atendente.status}
                  </span>
                </div>

                <div className="monitor-count-row">
                  <span className="queue-meta">Em atendimento</span>
                  <strong className="monitor-count-value">{atendente.conversas.length}</strong>
                </div>

                <div className="region-tags">
                  {REGIOES_SUPORTE.map((regiao) => (
                    <button
                      key={`${atendente.email}-${regiao}`}
                      className={`tag-button ${(atendente.regioes || []).includes(regiao) ? "active" : ""}`}
                      onClick={() => alternarRegiao(atendente.email, regiao, atendente.regioes || [])}
                    >
                      {regiao}
                    </button>
                  ))}
                </div>

                <div className="monitor-conversations">
                  <div className="monitor-conversations-label">Clientes em atendimento</div>
                  {atendente.conversas.length === 0 ? (
                    <div className="empty-state">Sem conversa ativa.</div>
                  ) : (
                    atendente.conversas.map((conversa) => (
                      <div
                        className={`mini-chat-card mini-chat-card-compact ${conversaAberta?.cpf === conversa.cpf ? "selected" : ""}`}
                        key={conversa.cpf}
                      >
                        <button type="button" className="mini-chat-open" onClick={() => acompanhar(conversa.cpf)}>
                        <strong className="mini-chat-title">{conversa.entregador.nome || conversa.cpf}</strong>
                        <span className="queue-meta">
                          {conversa.entregador.regiao || "-"}{conversa.aguardandoResposta ? " • aguardando" : ""}
                        </span>
                        </button>
                        <button type="button" className="ghost-button small mini-chat-assume" onClick={() => assumir(conversa.cpf)}>
                          Assumir
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>

          <aside className="observer-panel">
            {!conversaAberta ? (
              <div className="empty-state">Abra uma conversa para acompanhar em tempo real sem assumir o atendimento.</div>
            ) : (
              <>
                <div className="monitor-head">
                  <div>
                    <strong>{conversaAberta.entregador.nome || conversaAberta.cpf}</strong>
                    <div className="queue-meta">
                      Atendente atual: {conversaAberta.atendente?.nome || "-"}
                    </div>
                  </div>
                  <div className="mini-chat-actions">
                    <button className="secondary-button small" onClick={() => assumir(conversaAberta.cpf)}>
                      Assumir
                    </button>
                    <button className="ghost-button small" onClick={() => setConversaAberta(null)}>
                      Fechar
                    </button>
                  </div>
                </div>

                <div className="mini-chat-meta-grid">
                  <div className="queue-meta">CPF: {conversaAberta.cpf}</div>
                  <div className="queue-meta">Tel: {conversaAberta.entregador.telefone || "-"}</div>
                  <div className="queue-meta">Regiao: {conversaAberta.entregador.regiao || "-"}</div>
                  <div className="queue-meta">
                    {conversaAberta.messages.length} mensagem{conversaAberta.messages.length === 1 ? "" : "ens"}
                  </div>
                </div>

                <div className="observer-thread">
                  {conversaAberta.messages.map((mensagem) => (
                    <div className="mini-chat-message" key={mensagem.id}>
                      <strong>
                        {mensagem.from.includes("@")
                          ? mensagem.from
                          : conversaAberta.entregador.nome || conversaAberta.cpf}
                      </strong>
                      <MediaPreview media={mensagem.media} />
                      <small>{formatarHora(mensagem.createdAt)}</small>
                    </div>
                  ))}
                </div>

                <div className="history-list" style={{ marginTop: 16 }}>
                  <strong>Historico</strong>
                  {conversaAberta.history.length === 0 ? (
                    <div className="empty-state">Nenhum atendimento finalizado ainda.</div>
                  ) : (
                    conversaAberta.history.map((item) => (
                      <div className="history-card" key={item.id}>
                        <strong>{item.atendenteAtual?.nome || "Atendimento"}</strong>
                        <div className="queue-meta">Inicio: {formatarDataHora(item.iniciadoEm)}</div>
                        <div className="queue-meta">Fim: {formatarDataHora(item.finalizadoEm)}</div>
                        <div className="queue-meta">Finalizado por: {item.finalizadoPor?.nome || "-"}</div>
                        <div className="history-thread">
                          {(item.mensagens || []).map((mensagem) => (
                            <div className="history-message" key={mensagem.id}>
                              <strong>
                                {mensagem.from.includes("@")
                                  ? mensagem.from
                                  : conversaAberta.entregador.nome || conversaAberta.cpf}
                              </strong>
                              <MediaPreview media={mensagem.media} />
                              <small>{formatarDataHora(mensagem.createdAt)}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

export default Acompanhamento;
