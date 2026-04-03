import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_URL } from "./config";

const LOGO_URL = `${process.env.PUBLIC_URL}/logo192.png`;

function formatarHora(data) {
  return new Date(data).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatarDataHora(data) {
  return new Date(data).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function lerArquivoComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function blobParaDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Nao foi possivel processar o audio."));
    reader.readAsDataURL(blob);
  });
}

function formatarDuracao(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) return "0:00";
  const minutos = Math.floor(segundos / 60);
  const resto = Math.floor(segundos % 60);
  return `${minutos}:${String(resto).padStart(2, "0")}`;
}

function mesclarMensagens(atual = [], recebidas = []) {
  const mapa = new Map();

  atual.forEach((item) => {
    mapa.set(item.id || `${item.from}-${item.createdAt}-${item.text}`, item);
  });

  recebidas.forEach((item) => {
    const chave = item.id || `${item.from}-${item.createdAt}-${item.text}`;
    mapa.set(chave, item);
  });

  return Array.from(mapa.values()).sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );
}

function adicionarOuAtualizarMensagem(atual = [], nova) {
  if (atual.some((item) => item.id === nova.id)) {
    return atual.map((item) => (item.id === nova.id ? { ...item, ...nova } : item));
  }

  const semLocalDuplicada = atual.filter((item) => {
    if (!item.local || item.from !== nova.from) return true;

    const mesmaMidia =
      (!item.media && !nova.media) ||
      (item.media?.type === nova.media?.type && item.media?.dataUrl === nova.media?.dataUrl);

    return !(item.text === nova.text && mesmaMidia);
  });

  return [...semLocalDuplicada, nova];
}

function StatusChecks({ message }) {
  const visto = Boolean(message?.seenByCounterpartAt);
  const entregue = Boolean(message?.deliveredToCounterpartAt);
  const checks = visto || entregue ? "✓✓" : "✓";

  return <span className={`chat-checks ${visto ? "seen" : "sent"}`}>{checks}</span>;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-svg">
      <path
        d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"
        fill="currentColor"
      />
    </svg>
  );
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
    <div className="audio-chip whatsapp-audio-chip">
      <button type="button" className="audio-play" onClick={alternar}>
        {tocando ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="audio-visual">
        <div className="audio-wave">
          {Array.from({ length: 24 }).map((_, index) => {
            const ativo = duracao ? index / 24 <= tempoAtual / duracao : false;
            const alturas = [10, 14, 18, 12, 20, 16];
            return (
              <span
                key={`wave-${index}`}
                className={`audio-wave-bar ${ativo ? "active" : ""}`}
                style={{ height: `${alturas[index % alturas.length]}px` }}
              />
            );
          })}
        </div>
        <div className="audio-duration-row">
          <div className="audio-time">{formatarDuracao(duracao)}</div>
        </div>
      </div>
      <div className="audio-meta-time">{formatarHora(new Date().toISOString())}</div>
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
    return <img className="chat-media-image" src={media.dataUrl} alt={media.name || "Imagem enviada"} />;
  }

  if (media.type === "video") {
    return <video className="chat-media-image" src={media.dataUrl} controls preload="metadata" />;
  }

  if (media.type === "audio") {
    return <AudioPlayer src={media.dataUrl} />;
  }

  if (media.type === "file") {
    return (
      <a className="chat-history-link" href={media.dataUrl} download={media.name || "arquivo"}>
        {media.name || "Baixar arquivo"}
      </a>
    );
  }

  return null;
}

function Chat({ entregador, onBack }) {
  const socket = useMemo(() => io(API_URL, { autoConnect: false }), []);
  const cpf = entregador.cpf;
  const imageInputRef = useRef(null);
  const threadRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const cancelarGravacaoRef = useRef(false);
  const timerGravacaoRef = useRef(null);
  const [msg, setMsg] = useState("");
  const [chat, setChat] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [atendente, setAtendente] = useState(null);
  const [aba, setAba] = useState("chat");
  const [aviso, setAviso] = useState(null);
  const [gravando, setGravando] = useState(false);
  const [gravacaoPausada, setGravacaoPausada] = useState(false);
  const [tempoGravacao, setTempoGravacao] = useState(0);

  const adicionarMensagemLocal = (payload) => {
    setChat((atual) => {
      const existeIgual = atual.some(
        (item) =>
          item.id === payload.id ||
          (item.local &&
            item.from === payload.from &&
            item.text === payload.text &&
            item.createdAt === payload.createdAt)
      );

      if (existeIgual) return atual;
      return [...atual, payload];
    });
  };

  useLayoutEffect(() => {
    if (aba !== "chat") return;
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [chat, aba]);

  useEffect(() => {
    if (aba !== "chat") return;
    socket.emit("marcar_lidas", { viewer: cpf, cpf });
  }, [socket, cpf, aba, chat.length]);

  useEffect(() => {
    const registrarLogin = () => {
      socket.emit("login", {
        id: cpf,
        tipo: "entregador",
        nome: entregador.nome,
        telefone: entregador.telefone,
        regiao: entregador.regiao
      });
    };

    socket.on("connect", registrarLogin);
    socket.connect();

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const tocarAviso = () => {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.015);
      master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.34);
      master.connect(ctx.destination);

      const notas = [
        { freq: 830, start: 0, duration: 0.08 },
        { freq: 1120, start: 0.11, duration: 0.12 }
      ];

      notas.forEach((nota, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(nota.freq, ctx.currentTime + nota.start);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + nota.start);
        gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + nota.start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + nota.start + nota.duration);
        osc.connect(gain);
        gain.connect(master);
        osc.start(ctx.currentTime + nota.start);
        osc.stop(ctx.currentTime + nota.start + nota.duration + 0.02);

        if (index === notas.length - 1) {
          osc.onended = () => ctx.close();
        }
      });
    };

    const tocarAvisoDisparo = () => {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
      master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.05);
      master.connect(ctx.destination);

      const notas = [
        { freq: 1244, endFreq: 1480, start: 0.0, duration: 0.08, type: "square", gain: 0.34 },
        { freq: 1760, endFreq: 2092, start: 0.07, duration: 0.11, type: "triangle", gain: 0.3 },
        { freq: 2092, endFreq: 1568, start: 0.16, duration: 0.16, type: "sine", gain: 0.26 },
        { freq: 988, endFreq: 1318, start: 0.28, duration: 0.1, type: "triangle", gain: 0.22 },
        { freq: 1568, endFreq: 1760, start: 0.38, duration: 0.14, type: "sine", gain: 0.18 }
      ];

      notas.forEach((nota, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = nota.type;
        osc.frequency.setValueAtTime(nota.freq, ctx.currentTime + nota.start);
        osc.frequency.exponentialRampToValueAtTime(nota.endFreq, ctx.currentTime + nota.start + nota.duration);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + nota.start);
        gain.gain.exponentialRampToValueAtTime(nota.gain, ctx.currentTime + nota.start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + nota.start + nota.duration);
        osc.connect(gain);
        gain.connect(master);
        osc.start(ctx.currentTime + nota.start);
        osc.stop(ctx.currentTime + nota.start + nota.duration + 0.03);

        if (index === notas.length - 1) {
          osc.onended = () => ctx.close();
        }
      });
    };

    const mostrarNotificacao = (title, body) => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;

      const notificacao = new Notification(title, {
        body,
        icon: LOGO_URL,
        badge: LOGO_URL,
        tag: `foxlog-${cpf}`,
        renotify: true
      });

      window.setTimeout(() => notificacao.close(), 4200);
    };

    const descreverMensagem = (mensagem) => {
      if (mensagem?.text) return mensagem.text;
      if (mensagem?.media?.type === "audio") return "Mensagem de voz recebida";
      if (mensagem?.media?.type === "image") return "Imagem recebida";
      return "Nova mensagem da operacao";
    };

    const aoReceberEstado = (payload) => {
      setChat((atual) => mesclarMensagens(atual, payload.messages || []));
      setHistorico(payload.history || []);
      setAtendente(payload.atendente || payload.entregador?.atendenteAtual || null);
    };

    const aoReceberMensagem = (nova) => {
      if (nova.cpf !== cpf) return;
      setChat((atual) => adicionarOuAtualizarMensagem(atual, nova));

      if (nova.from !== cpf) {
        if (nova.kind === "broadcast") return;
        setAviso(nova.title || "Nova mensagem da operacao");
        tocarAviso();
        mostrarNotificacao("Suporte FoxLog", descreverMensagem(nova));
        window.setTimeout(() => setAviso(null), 2800);
      }
    };

    const aoAtualizarStatusMensagem = ({ cpf: cpfMensagem, message }) => {
      if (cpfMensagem !== cpf) return;
      setChat((atual) => atual.map((item) => (item.id === message.id ? { ...item, ...message } : item)));
    };

    const aoRemoverMensagem = ({ cpf: cpfMensagem, messageId }) => {
      if (cpfMensagem !== cpf) return;
      setChat((atual) => atual.filter((item) => item.id !== messageId));
    };

    const aoFinalizar = ({ history }) => {
      setAtendente(null);
      if (history) {
        setHistorico((atual) => [history, ...atual]);
      }
    };

    const aoAtendenteAtribuido = ({ cpf: cpfMensagem, atendente: novoAtendente }) => {
      if (cpfMensagem !== cpf) return;
      setAtendente(novoAtendente || null);
    };

    const aoAvisoDisparo = (payload) => {
      if (payload.cpf !== cpf) return;
      setAviso(payload.title || "Aviso da operacao");
      tocarAvisoDisparo();
      mostrarNotificacao(payload.title || "Aviso da operacao", payload.text || "Nova mensagem da operacao");
      window.setTimeout(() => setAviso(null), 3200);
    };

    socket.on("estado_entregador", aoReceberEstado);
    socket.on("msg", aoReceberMensagem);
    socket.on("msg_confirmed", aoReceberMensagem);
    socket.on("msg_status", aoAtualizarStatusMensagem);
    socket.on("msg_deleted", aoRemoverMensagem);
    socket.on("broadcast_notice", aoAvisoDisparo);
    socket.on("atendimento_finalizado", aoFinalizar);
    socket.on("atendente_atribuido", aoAtendenteAtribuido);

    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (timerGravacaoRef.current) {
        clearInterval(timerGravacaoRef.current);
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      socket.off("connect", registrarLogin);
      socket.off("estado_entregador", aoReceberEstado);
      socket.off("msg", aoReceberMensagem);
      socket.off("msg_confirmed", aoReceberMensagem);
      socket.off("msg_status", aoAtualizarStatusMensagem);
      socket.off("msg_deleted", aoRemoverMensagem);
      socket.off("broadcast_notice", aoAvisoDisparo);
      socket.off("atendimento_finalizado", aoFinalizar);
      socket.off("atendente_atribuido", aoAtendenteAtribuido);
      socket.disconnect();
    };
  }, [socket, cpf, entregador.nome, entregador.telefone, entregador.regiao]);

  const enviar = () => {
    if (!msg.trim()) return;

    const texto = msg.trim();
    adicionarMensagemLocal({
      id: `local-${Date.now()}`,
      cpf,
      from: cpf,
      text: texto,
      createdAt: new Date().toISOString(),
      local: true
    });

    socket.emit("msg", {
      from: cpf,
      to: atendente,
      text: texto
    });

    setMsg("");
  };

  const enviarArquivo = async (file, type) => {
    if (!file) return;

    try {
      const dataUrl = await lerArquivoComoDataUrl(file);
      adicionarMensagemLocal({
        id: `local-${Date.now()}`,
        cpf,
        from: cpf,
        text: "",
        media: {
          type,
          name: file.name,
          mimeType: file.type,
          dataUrl
        },
        createdAt: new Date().toISOString(),
        local: true
      });

      socket.emit("msg", {
        from: cpf,
        to: atendente,
        text: "",
        media: {
          type,
          name: file.name,
          mimeType: file.type,
          dataUrl
        }
      });
    } catch (_) {
      setAviso("Nao foi possivel enviar o arquivo.");
      window.setTimeout(() => setAviso(null), 2200);
    }
  };

  const iniciarGravacao = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      cancelarGravacaoRef.current = false;
      setTempoGravacao(0);
      setGravacaoPausada(false);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (timerGravacaoRef.current) {
          clearInterval(timerGravacaoRef.current);
          timerGravacaoRef.current = null;
        }
        setGravacaoPausada(false);

        if (cancelarGravacaoRef.current || !blob.size) {
          cancelarGravacaoRef.current = false;
          setTempoGravacao(0);
          return;
        }

        try {
          const dataUrl = await blobParaDataUrl(blob);
          adicionarMensagemLocal({
            id: `local-${Date.now()}`,
            cpf,
            from: cpf,
            text: "",
            media: {
              type: "audio",
              name: `voz-${Date.now()}.webm`,
              mimeType: blob.type || "audio/webm",
              dataUrl
            },
            createdAt: new Date().toISOString(),
            local: true
          });

          socket.emit("msg", {
            from: cpf,
            to: atendente,
            text: "",
            media: {
              type: "audio",
              name: `voz-${Date.now()}.webm`,
              mimeType: blob.type || "audio/webm",
              dataUrl
            }
          });
        } catch (_) {
          setAviso("Nao foi possivel enviar o audio.");
          window.setTimeout(() => setAviso(null), 2200);
        }
      };

      mediaRecorder.start();
      timerGravacaoRef.current = window.setInterval(() => {
        setTempoGravacao((atual) => atual + 1);
      }, 1000);
      setGravando(true);
    } catch (_) {
      setAviso("Libere o microfone para gravar audio.");
      window.setTimeout(() => setAviso(null), 2200);
    }
  };

  const pararGravacao = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      mediaRecorderRef.current.stop();
    }
    setGravando(false);
  };

  const alternarPausaGravacao = () => {
    const gravador = mediaRecorderRef.current;
    if (!gravador) return;

    if (gravador.state === "recording") {
      mediaStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      if (typeof gravador.pause === "function") {
        gravador.pause();
      }
      if (timerGravacaoRef.current) {
        clearInterval(timerGravacaoRef.current);
        timerGravacaoRef.current = null;
      }
      setGravacaoPausada(true);
      return;
    }

    if (gravador.state === "paused") {
      mediaStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      gravador.resume();
      timerGravacaoRef.current = window.setInterval(() => {
        setTempoGravacao((atual) => atual + 1);
      }, 1000);
      setGravacaoPausada(false);
    }
  };

  const cancelarGravacao = () => {
    cancelarGravacaoRef.current = true;
    if (timerGravacaoRef.current) {
      clearInterval(timerGravacaoRef.current);
      timerGravacaoRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    } else if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      mediaRecorderRef.current.stop();
    } else {
      audioChunksRef.current = [];
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    }
    setTempoGravacao(0);
    setGravando(false);
    setGravacaoPausada(false);
  };

  const emojisRapidos = ["😀", "👍", "🚚", "✅", "📦"];

  return (
    <div className="chat-page">
      <img className="fox-watermark" src={LOGO_URL} alt="" aria-hidden="true" />
      <div className="chat-shell whatsapp-shell">
        {aviso ? <div className="notice-banner">{aviso}</div> : null}
        <div className="chat-topbar">
          <div className="chat-header-profile">
            <img className="deliverer-logo small" src={LOGO_URL} alt="FoxLog" />
            <div>
              <strong>Suporte FoxLog</strong>
              <div className="chat-attendant">
                {atendente ? `Atendente: ${atendente.nome}` : "Aguardando atribuicao de atendente"}
              </div>
            </div>
          </div>

          <button className="deliverer-secondary" onClick={onBack}>
            Voltar
          </button>
        </div>

        <div className="chat-tabs">
          <button className={`chat-tab ${aba === "chat" ? "active" : ""}`} onClick={() => setAba("chat")}>
            Conversa
          </button>
          <button className={`chat-tab ${aba === "historico" ? "active" : ""}`} onClick={() => setAba("historico")}>
            Historico
          </button>
        </div>

        {aba === "chat" ? (
          <div className="chat-thread" ref={threadRef}>
            {chat.length === 0 ? (
              <div className="chat-empty">
                Nenhuma mensagem ainda. Assim que o atendimento comecar, a conversa aparece aqui.
              </div>
            ) : (
              chat.map((item) => (
                <div className={`chat-bubble ${item.from === cpf ? "mine" : ""} ${item.kind === "broadcast" ? "broadcast" : ""}`} key={item.id}>
                  {item.from !== cpf ? <div className="chat-sender">{item.kind === "broadcast" ? "Aviso da operacao" : atendente?.nome || "Suporte"}</div> : null}
                  {item.text ? <div>{item.text}</div> : null}
                  <MediaPreview media={item.media} />
                  <div className="chat-time">
                    <span>{formatarHora(item.createdAt)}</span>
                    {item.from === cpf ? <StatusChecks message={item} /> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="chat-thread history-mode">
            {historico.length === 0 ? (
              <div className="chat-empty">Nenhum atendimento finalizado ainda.</div>
            ) : (
              historico.map((item) => (
                <div className="deliverer-history-card" key={item.id}>
                  <strong>{item.atendenteAtual?.nome || "Atendimento"}</strong>
                  <div className="chat-time">Inicio: {formatarDataHora(item.iniciadoEm)}</div>
                  <div className="chat-time">Fim: {formatarDataHora(item.finalizadoEm)}</div>
                  <div className="deliverer-history-thread">
                    {(item.mensagens || []).map((mensagem) => (
                      <div className="deliverer-history-message" key={mensagem.id}>
                        <strong>{mensagem.from.includes("@") ? mensagem.from : "Voce"}</strong>
                        {mensagem.text ? <span>{mensagem.text}</span> : null}
                        <MediaPreview media={mensagem.media} />
                        <small>{formatarDataHora(mensagem.createdAt)}</small>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <div className="chat-composer">
          {gravando ? (
            <div className="recording-shell">
              <button className="recording-cancel" onClick={cancelarGravacao} disabled={aba !== "chat"}>
                Cancelar
              </button>
              <div className={`recording-panel ${gravacaoPausada ? "paused" : ""}`}>
                <div className="recording-status">
                  <span className="recording-dot" />
                  <span>{gravacaoPausada ? "Audio pausado" : "Gravando audio"}</span>
                </div>
                <div className="recording-wave">
                  {Array.from({ length: 28 }).map((_, index) => {
                    const alturas = [14, 18, 24, 16, 12, 20];
                    return <span key={`rec-wave-${index}`} style={{ height: `${alturas[index % alturas.length]}px` }} />;
                  })}
                </div>
                <div className="recording-time">{formatarDuracao(tempoGravacao)}</div>
              </div>
              <button
                className="deliverer-secondary recording-toggle"
                onClick={alternarPausaGravacao}
                disabled={aba !== "chat"}
              >
                {gravacaoPausada ? "Continuar" : "Pausar"}
              </button>
              <button className="deliverer-primary round recording-send" onClick={pararGravacao} disabled={aba !== "chat"}>
                {">"}
              </button>
            </div>
          ) : (
            <>
              <div className="chat-tools">
                {emojisRapidos.map((emoji) => (
                  <button key={emoji} className="emoji-button" onClick={() => setMsg((atual) => `${atual}${emoji}`)} disabled={aba !== "chat"}>
                    {emoji}
                  </button>
                ))}
                <button className="emoji-button" onClick={() => imageInputRef.current?.click()} disabled={aba !== "chat"}>
                  Foto
                </button>
              </div>
              <div className="chat-composer-main">
                <input
                  placeholder="Escreva sua mensagem..."
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      enviar();
                    }
                  }}
                  disabled={aba !== "chat"}
                />
                <button
                  className="deliverer-secondary round-icon whatsapp-mic-button"
                  onClick={iniciarGravacao}
                  disabled={aba !== "chat"}
                  title="Gravar audio"
                >
                  <MicIcon />
                </button>
                <button className="deliverer-primary round" onClick={enviar} disabled={aba !== "chat"}>
                  {">"}
                </button>
              </div>
            </>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              enviarArquivo(file, "image");
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default Chat;

