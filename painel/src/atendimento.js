import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_URL } from "./config";

const TEXTOS_PRONTOS_FALLBACK = [
  { id: "texto-1", label: "Em analise", text: "Ola! Estamos verificando sua solicitacao." },
  { id: "texto-2", label: "Confirmar nome", text: "Pode me confirmar seu nome completo, por favor?" },
  { id: "texto-3", label: "Acionar operacao", text: "Recebido. Vou acionar a operacao e retorno em seguida." },
  { id: "texto-4", label: "Em acompanhamento", text: "Seu caso foi encaminhado e seguimos acompanhando." }
];

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
  const mescladas = [];

  [...atual, ...recebidas].forEach((item) => {
    const indiceMesmoId = mescladas.findIndex((existente) => existente.id === item.id);
    if (indiceMesmoId >= 0) {
      mescladas[indiceMesmoId] = { ...mescladas[indiceMesmoId], ...item };
      return;
    }

    const indiceDuplicadaLocal = mescladas.findIndex((existente) => {
      if (
        !String(existente.id || "").startsWith("local-") &&
        !String(item.id || "").startsWith("local-")
      ) {
        return false;
      }

      const mesmaMidia =
        (!existente.media && !item.media) ||
        (existente.media?.type === item.media?.type && existente.media?.dataUrl === item.media?.dataUrl);

      return existente.from === item.from && existente.text === item.text && mesmaMidia;
    });

    if (indiceDuplicadaLocal >= 0) {
      mescladas[indiceDuplicadaLocal] = { ...mescladas[indiceDuplicadaLocal], ...item };
      return;
    }

    mescladas.push(item);
  });

  return mescladas.sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );
}

function adicionarOuAtualizarMensagem(atual = [], nova) {
  if (atual.some((item) => item.id === nova.id)) {
    return atual.map((item) => (item.id === nova.id ? { ...item, ...nova } : item));
  }

  const semLocalDuplicada = atual.filter((item) => {
    if (!String(item.id || "").startsWith("local-") || item.from !== nova.from) return true;

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

  return <span className={`message-checks ${visto ? "seen" : "sent"}`}>{checks}</span>;
}

function iniciaisContato(nome = "", fallback = "") {
  const base = String(nome || fallback || "").trim();
  if (!base) return "FX";

  const partes = base.split(/\s+/).filter(Boolean).slice(0, 2);
  return partes.map((item) => item[0]).join("").toUpperCase();
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

  if (media.type === "video") {
    return <video className="message-media-image" src={media.dataUrl} controls preload="metadata" />;
  }

  if (media.type === "audio") {
    return <AudioPlayer src={media.dataUrl} />;
  }

  if (media.type === "file") {
    return (
      <a className="queue-meta" href={media.dataUrl} download={media.name || "arquivo"}>
        {media.name || "Baixar arquivo"}
      </a>
    );
  }

  return null;
}

function criarTextoProntoVazio() {
  return {
    id: `texto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: "",
    text: ""
  };
}

function criarPerfilContato(entregador = {}, cpf = "") {
  return {
    nome: entregador.nome || "",
    cpf: entregador.cpf || cpf,
    telefone: entregador.celular || entregador.telefone || "",
    cidade: entregador.cidade || entregador.regiao || "",
    hotZone: entregador.hotZone || entregador.hotzone || entregador.hot_zone || "",
    observacoes: entregador.observacoes || ""
  };
}

function Atendimento({ user, onBack, onGoToDisparo, onGoToAcompanhamento, cpfInicial = null }) {
  const logoUrl = `${process.env.PUBLIC_URL}/logo192.png`;
  const socket = useMemo(() => io(API_URL, { autoConnect: false }), []);
  const contatoAtualRef = useRef(null);
  const ativosRef = useRef([]);
  const cpfInicialRef = useRef(cpfInicial);
  const cpfInicialAbertoRef = useRef(false);
  const chatAreaRef = useRef(null);
  const imageInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const cancelarGravacaoRef = useRef(false);
  const timerGravacaoRef = useRef(null);
  const [fila, setFila] = useState([]);
  const [baseOperacao, setBaseOperacao] = useState([]);
  const [buscaConversas, setBuscaConversas] = useState("");
  const [filtroConversas, setFiltroConversas] = useState("ativos");
  const [ativos, setAtivos] = useState([]);
  const [atendentes, setAtendentes] = useState([]);
  const [contatoAtual, setContatoAtual] = useState(null);
  const [chat, setChat] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [historicoAbertoId, setHistoricoAbertoId] = useState(null);
  const [abaLateral, setAbaLateral] = useState("perfil");
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState("");
  const [meuStatus, setMeuStatus] = useState("online");
  const [salvando, setSalvando] = useState(false);
  const [apagandoId, setApagandoId] = useState(null);
  const [mostrarTransferencia, setMostrarTransferencia] = useState(false);
  const [destinoTransferencia, setDestinoTransferencia] = useState("");
  const [gravando, setGravando] = useState(false);
  const [tempoGravacao, setTempoGravacao] = useState(0);
  const [textosProntos, setTextosProntos] = useState(TEXTOS_PRONTOS_FALLBACK);
  const [editorTextosAberto, setEditorTextosAberto] = useState(false);
  const [textosEditaveis, setTextosEditaveis] = useState(TEXTOS_PRONTOS_FALLBACK);
  const [salvandoTextos, setSalvandoTextos] = useState(false);
  const [perfil, setPerfil] = useState({
    nome: "",
    cpf: "",
    telefone: "",
    cidade: "",
    hotZone: "",
    observacoes: ""
  });

  useEffect(() => {
    contatoAtualRef.current = contatoAtual;
  }, [contatoAtual]);

  useEffect(() => {
    cpfInicialRef.current = cpfInicial;
    cpfInicialAbertoRef.current = false;
  }, [cpfInicial]);

  useEffect(() => {
    ativosRef.current = ativos;
  }, [ativos]);

  useEffect(() => {
    async function carregarBase() {
      const [respostaEntregadores, respostaTextos] = await Promise.all([
        fetch(`${API_URL}/entregadores?email=${encodeURIComponent(user.email)}`),
        fetch(`${API_URL}/config/textos-prontos`)
      ]);
      const dadosEntregadores = await respostaEntregadores.json();
      const dadosTextos = await respostaTextos.json();
      setBaseOperacao(dadosEntregadores.entregadores || []);
      setTextosProntos(dadosTextos.textosProntos || TEXTOS_PRONTOS_FALLBACK);
    }

    carregarBase();
  }, [user.email]);

  useLayoutEffect(() => {
    const area = chatAreaRef.current;
    if (!area) return;
    area.scrollTop = area.scrollHeight;
  }, [chat, contatoAtual?.cpf]);

  useEffect(() => {
    if (!contatoAtual?.cpf) return;
    socket.emit("marcar_lidas", { viewer: user.email, cpf: contatoAtual.cpf });
  }, [socket, user.email, contatoAtual?.cpf, chat.length]);

  useEffect(() => {
    const registrarLogin = () => {
      socket.emit("login", { id: user.email, tipo: "atendente" });
    };

    socket.on("connect", registrarLogin);
    socket.connect();

    const aoReceberPainel = (payload) => {
      setFila(payload.fila || []);
      setAtendentes(payload.atendentes || []);
      const meusAtivos = (payload.ativos || []).filter((item) => item.atendente?.email === user.email);
      setAtivos(meusAtivos);
      const eu = (payload.atendentes || []).find((item) => item.email === user.email);
      if (eu?.disponibilidade) {
        setMeuStatus(eu.disponibilidade);
      }

      if (cpfInicialRef.current && !cpfInicialAbertoRef.current) {
        cpfInicialAbertoRef.current = true;
        socket.emit("abrir_conversa", { email: user.email, cpf: cpfInicialRef.current });
        return;
      }

      if (!contatoAtualRef.current && meusAtivos[0]) {
        socket.emit("abrir_conversa", { email: user.email, cpf: meusAtivos[0].cpf });
      }
    };

    const aoReceberChat = ({ cpf, entregador, atendente, messages, history }) => {
      setContatoAtual({ ...entregador, cpf, atendente });
      setPerfil(criarPerfilContato(entregador, cpf));
      setChat(mesclarMensagens([], messages || []));
      setHistorico(history || []);
      setHistoricoAbertoId(null);
      setAbaLateral("perfil");
      setMostrarTransferencia(false);
      setErro("");
      socket.emit("marcar_lidas", { viewer: user.email, cpf });
    };

    const aoReceberMensagem = (nova) => {
      const conversaAtiva = ativosRef.current.find((item) => item.cpf === nova.cpf);

      if (!contatoAtualRef.current && conversaAtiva) {
        socket.emit("abrir_conversa", { email: user.email, cpf: nova.cpf });
      }

      if (contatoAtualRef.current?.cpf === nova.cpf) {
        setChat((atual) => adicionarOuAtualizarMensagem(atual, nova));
        if (nova.from !== user.email) {
          socket.emit("marcar_lidas", { viewer: user.email, cpf: nova.cpf });
        }
      }
    };

    const aoAtualizarStatusMensagem = ({ cpf, message }) => {
      if (contatoAtualRef.current?.cpf !== cpf) return;
      setChat((atual) => atual.map((item) => (item.id === message.id ? { ...item, ...message } : item)));
    };

    const aoRemoverMensagem = ({ cpf, messageId }) => {
      if (contatoAtualRef.current?.cpf !== cpf) return;
      setChat((atual) => atual.filter((item) => item.id !== messageId));
    };

    const aoAtualizarEntregador = (entregador) => {
      setFila((atual) => atual.map((item) => (item.cpf === entregador.cpf ? entregador : item)));
      setBaseOperacao((atual) => {
        if (atual.some((item) => item.cpf === entregador.cpf)) {
          return atual.map((item) => (item.cpf === entregador.cpf ? { ...item, ...entregador } : item));
        }

        return [entregador, ...atual];
      });
      setAtivos((atual) =>
        atual.map((item) => (item.cpf === entregador.cpf ? { ...item, entregador: { ...item.entregador, ...entregador } } : item))
      );

      if (contatoAtualRef.current?.cpf === entregador.cpf) {
        setContatoAtual((atual) => ({ ...atual, ...entregador }));
        setPerfil((atual) => ({ ...atual, ...criarPerfilContato(entregador, entregador.cpf) }));
      }
    };

    const aoFinalizar = ({ cpf, history }) => {
      setAtivos((atual) => atual.filter((item) => item.cpf !== cpf));

      if (history && contatoAtualRef.current?.cpf === cpf) {
        setHistorico((atual) => [history, ...atual]);
        setHistoricoAbertoId(null);
        setAbaLateral("historico");
      }

      if (contatoAtualRef.current?.cpf === cpf) {
        setContatoAtual(null);
        setChat([]);
        setMsg("");
      }
    };

    const aoTransferir = ({ cpf, motivo }) => {
      setAtivos((atual) => atual.filter((item) => item.cpf !== cpf));
      if (contatoAtualRef.current?.cpf === cpf) {
        setContatoAtual(null);
        setChat([]);
        setMsg("");
      }
      setErro(motivo);
    };

    socket.on("painel_estado", aoReceberPainel);
    socket.on("chat_assigned", aoReceberChat);
    socket.on("msg", aoReceberMensagem);
    socket.on("msg_confirmed", aoReceberMensagem);
    socket.on("msg_status", aoAtualizarStatusMensagem);
    socket.on("msg_deleted", aoRemoverMensagem);
    socket.on("entregador_atualizado", aoAtualizarEntregador);
    socket.on("erro_atendimento", setErro);
    socket.on("atendimento_finalizado", aoFinalizar);
    socket.on("chat_transferido", aoTransferir);

    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (timerGravacaoRef.current) {
        clearInterval(timerGravacaoRef.current);
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      socket.off("connect", registrarLogin);
      socket.off("painel_estado", aoReceberPainel);
      socket.off("chat_assigned", aoReceberChat);
      socket.off("msg", aoReceberMensagem);
      socket.off("msg_confirmed", aoReceberMensagem);
      socket.off("msg_status", aoAtualizarStatusMensagem);
      socket.off("msg_deleted", aoRemoverMensagem);
      socket.off("entregador_atualizado", aoAtualizarEntregador);
      socket.off("erro_atendimento", setErro);
      socket.off("atendimento_finalizado", aoFinalizar);
      socket.off("chat_transferido", aoTransferir);
      socket.disconnect();
    };
  }, [socket, user.email]);

  const abrirConversa = (cpf) => {
    socket.emit("abrir_conversa", { email: user.email, cpf });
  };

  const abrirConversaAtiva = (cpf) => {
    socket.emit("abrir_conversa_ativa", { email: user.email, cpf });
  };

  const enviar = () => {
    if (!contatoAtual || !msg.trim()) return;

    const texto = msg.trim();
    setChat((atual) => [
      ...atual,
      {
        id: `local-${Date.now()}`,
        cpf: contatoAtual.cpf,
        from: user.email,
        text: texto,
        createdAt: new Date().toISOString()
      }
    ]);

    socket.emit("msg", {
      from: user.email,
      to: contatoAtual.cpf,
      text: texto
    });

    setMsg("");
  };

  const enviarArquivo = async (file, type) => {
    if (!contatoAtual || !file) return;

    try {
      const dataUrl = await lerArquivoComoDataUrl(file);
      const payload = {
        id: `local-${Date.now()}`,
        cpf: contatoAtual.cpf,
        from: user.email,
        text: "",
        media: {
          type,
          name: file.name,
          mimeType: file.type,
          dataUrl
        },
        createdAt: new Date().toISOString()
      };

      setChat((atual) => [...atual, payload]);

      socket.emit("msg", {
        from: user.email,
        to: contatoAtual.cpf,
        text: "",
        media: payload.media
      });
    } catch (err) {
      setErro(err.message);
    }
  };

  const iniciarGravacao = async () => {
    if (!contatoAtual) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      cancelarGravacaoRef.current = false;
      setTempoGravacao(0);

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

        if (cancelarGravacaoRef.current || !blob.size) {
          cancelarGravacaoRef.current = false;
          setTempoGravacao(0);
          return;
        }

        try {
          const dataUrl = await blobParaDataUrl(blob);
          const media = {
            type: "audio",
            name: `voz-${Date.now()}.webm`,
            mimeType: blob.type || "audio/webm",
            dataUrl
          };

          setChat((atual) => [
            ...atual,
            {
              id: `local-${Date.now()}`,
              cpf: contatoAtual.cpf,
              from: user.email,
              text: "",
              media,
              createdAt: new Date().toISOString()
            }
          ]);

          socket.emit("msg", {
            from: user.email,
            to: contatoAtual.cpf,
            text: "",
            media
          });
        } catch (err) {
          setErro(err.message);
        }
      };

      mediaRecorder.start();
      timerGravacaoRef.current = window.setInterval(() => {
        setTempoGravacao((atual) => atual + 1);
      }, 1000);
      setGravando(true);
    } catch (_) {
      setErro("Libere o microfone para gravar audio.");
    }
  };

  const pararGravacao = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setGravando(false);
  };

  const cancelarGravacao = () => {
    cancelarGravacaoRef.current = true;
    if (timerGravacaoRef.current) {
      clearInterval(timerGravacaoRef.current);
      timerGravacaoRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    } else {
      audioChunksRef.current = [];
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    }
    setTempoGravacao(0);
    setGravando(false);
  };

  const emojisRapidos = ["😀", "👍", "🚚", "✅", "📦"];

  const alterarStatus = (novoStatus) => {
    setMeuStatus(novoStatus);
    socket.emit("set_status", { email: user.email, status: novoStatus });
  };

  const transferirPara = (emailDestino) => {
    if (!contatoAtual) return;
    socket.emit("transferir_conversa", {
      email: user.email,
      cpf: contatoAtual.cpf,
      para: emailDestino
    });
    setMostrarTransferencia(false);
    setDestinoTransferencia("");
  };

  const finalizarConversa = () => {
    if (!contatoAtual) return;
    socket.emit("finalizar_atendimento", {
      atendente: user.email,
      cpf: contatoAtual.cpf
    });
    setMostrarTransferencia(false);
    setDestinoTransferencia("");
  };

  const minhasRegioes =
    atendentes.find((item) => item.email === user.email)?.regioes?.filter(Boolean) || [];
  const baseOperacaoVisivel = minhasRegioes.length
    ? baseOperacao.filter((item) => minhasRegioes.includes(item.regiao || ""))
    : baseOperacao;
  const opcoesTransferencia = atendentes.filter((item) => item.email !== user.email);
  const destinoTransferenciaSelecionado =
    opcoesTransferencia.find((item) => item.email === destinoTransferencia) || null;
  const contatoEhAtivo = contatoAtual ? ativos.some((item) => item.cpf === contatoAtual.cpf) : false;
  const atendimentoAtual = contatoAtual ? ativos.find((item) => item.cpf === contatoAtual.cpf) || null : null;
  const historicoSelecionado = historico.find((item) => item.id === historicoAbertoId) || null;
  const baseFiltrada = baseOperacaoVisivel
    .filter((item) => {
      const termo = buscaConversas.trim().toLowerCase();
      if (!termo) return true;
      return (
        (item.nome || "").toLowerCase().includes(termo) ||
        item.cpf.includes(termo) ||
        (item.regiao || "").toLowerCase().includes(termo)
      );
    });
  const conversasEmAtendimento = ativos
    .map((item) => {
      const ultimaMensagem = [...(item.messages || [])].sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      )[0];

      return {
        ...item,
        ultimaMensagem
      };
    })
    .sort(
      (a, b) =>
        new Date(b.ultimaMensagem?.createdAt || 0).getTime() - new Date(a.ultimaMensagem?.createdAt || 0).getTime()
    );
  const listaConversasSidebar = [
    ...conversasEmAtendimento.map((item) => ({
      tipo: "ativo",
      cpf: item.cpf,
      nome: item.entregador.nome || item.cpf,
      regiao: item.entregador.regiao || "Nao informada",
      ultimaMensagem: item.ultimaMensagem,
      aguardandoResposta: item.aguardandoResposta
    })),
    ...fila.map((item) => ({
      tipo: "fila",
      cpf: item.cpf,
      nome: item.nome || item.cpf,
      regiao: item.regiao || "Nao informada",
      ultimaMensagem: null,
      aguardandoResposta: false
    })),
    ...baseFiltrada.map((item) => ({
      tipo: "contato",
      cpf: item.cpf,
      nome: item.nome || item.cpf,
      regiao: item.regiao || "Nao informada",
      ultimaMensagem: null,
      aguardandoResposta: false
    }))
  ].filter((item) => {
    if (filtroConversas === "ativos" && item.tipo !== "ativo") return false;
    if (filtroConversas === "fila" && item.tipo !== "fila") return false;
    if (filtroConversas === "contatos" && item.tipo !== "contato") return false;

    const termo = buscaConversas.trim().toLowerCase();
    if (!termo) return true;

    return (
      item.nome.toLowerCase().includes(termo) ||
      item.cpf.includes(termo) ||
      item.regiao.toLowerCase().includes(termo)
    );
    });

  const apagarMensagem = (messageId) => {
    if (!contatoAtual) return;
    setApagandoId(messageId);
    socket.emit("delete_msg", {
      email: user.email,
      cpf: contatoAtual.cpf,
      messageId
    });
    setTimeout(() => setApagandoId(null), 400);
  };

  const salvar = async () => {
    if (!contatoAtual) return;

    setSalvando(true);

    try {
      const resposta = await fetch(`${API_URL}/salvar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpf: contatoAtual.cpf,
          dados: {
            nome: perfil.nome,
            telefone: perfil.telefone,
            celular: perfil.telefone,
            regiao: perfil.cidade,
            cidade: perfil.cidade,
            hotZone: perfil.hotZone,
            observacoes: perfil.observacoes
          }
        })
      });

      if (!resposta.ok) {
        throw new Error("Nao foi possivel salvar os dados do entregador.");
      }
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  const abrirEditorTextos = () => {
    setTextosEditaveis(textosProntos.map((item) => ({ ...item })));
    setEditorTextosAberto(true);
  };

  const atualizarTextoEditavel = (id, campo, valor) => {
    setTextosEditaveis((atual) =>
      atual.map((item) => (item.id === id ? { ...item, [campo]: valor } : item))
    );
  };

  const adicionarTextoPronto = () => {
    setTextosEditaveis((atual) => [...atual, criarTextoProntoVazio()]);
  };

  const removerTextoPronto = (id) => {
    setTextosEditaveis((atual) => atual.filter((item) => item.id !== id));
  };

  const salvarTextosProntos = async () => {
    setSalvandoTextos(true);

    try {
      const resposta = await fetch(`${API_URL}/config/textos-prontos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          textosProntos: textosEditaveis
        })
      });

      const dados = await resposta.json();
      if (!resposta.ok) {
        throw new Error(dados.error || "Nao foi possivel salvar as mensagens prontas.");
      }

      setTextosProntos(dados.textosProntos || TEXTOS_PRONTOS_FALLBACK);
      setEditorTextosAberto(false);
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvandoTextos(false);
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand with-logo">
            <img className="brand-logo" src={logoUrl} alt="FoxLog" />
            <div>
              <strong>FoxLog Connect</strong>
              <span>Atendente: {user.nome}</span>
            </div>
          </div>

          {erro ? <div className="error-text">{erro}</div> : null}
        </div>

        <div className="sidebar-list">
          <section className="sidebar-block active-chat-block">
            <div className="sidebar-section-title">Conversas</div>
            <div className="whatsapp-toolbar">
              <input
                className="base-search whatsapp-search"
                placeholder="Buscar conversa"
                value={buscaConversas}
                onChange={(e) => setBuscaConversas(e.target.value)}
              />
              <div className="whatsapp-filters">
                <button
                  className={`whatsapp-filter-chip ${filtroConversas === "ativos" ? "active" : ""}`}
                  onClick={() => setFiltroConversas("ativos")}
                >
                  Atendendo
                </button>
                <button
                  className={`whatsapp-filter-chip ${filtroConversas === "fila" ? "active" : ""}`}
                  onClick={() => setFiltroConversas("fila")}
                >
                  Fila
                </button>
                <button
                  className={`whatsapp-filter-chip ${filtroConversas === "contatos" ? "active" : ""}`}
                  onClick={() => setFiltroConversas("contatos")}
                >
                  Contatos
                </button>
              </div>
            </div>
            <div className="sidebar-scroll whatsapp-chat-list">
              {listaConversasSidebar.length === 0 ? (
                <div className="empty-state">Nenhuma conversa encontrada.</div>
              ) : (
                listaConversasSidebar.map((item) => (
                  <button
                    key={`${item.tipo}-${item.cpf}`}
                    className={`whatsapp-chat-row ${contatoAtual?.cpf === item.cpf ? "selected" : ""}`}
                    onClick={() => (item.tipo === "ativo" ? abrirConversa(item.cpf) : abrirConversaAtiva(item.cpf))}
                  >
                    <div className="whatsapp-avatar">
                      {iniciaisContato(item.nome, item.cpf)}
                    </div>
                    <div className="whatsapp-chat-main">
                      <div className="whatsapp-chat-top">
                        <strong>{item.nome}</strong>
                        <span>{item.ultimaMensagem?.createdAt ? formatarHora(item.ultimaMensagem.createdAt) : ""}</span>
                      </div>
                      <div className="whatsapp-chat-bottom">
                        <span className="whatsapp-chat-preview">
                          {item.tipo === "ativo"
                            ? "Conversa em andamento"
                            : item.tipo === "fila"
                              ? `Na fila • ${item.regiao}`
                              : `Contato • ${item.regiao}`}
                        </span>
                        {item.tipo === "fila" ? (
                          <span className="whatsapp-chat-tag">Atender</span>
                        ) : item.tipo === "contato" ? (
                          <span className="whatsapp-chat-tag muted">Contato</span>
                        ) : item.aguardandoResposta ? (
                          <span className="whatsapp-chat-badge">1</span>
                        ) : (
                          <span className="whatsapp-chat-tag muted">Ativo</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

        </div>
      </aside>

      <main className="content">
        <div className="content-header">
          <div>
            {contatoAtual ? (
              <>
                <h2 style={{ margin: 0 }}>{contatoAtual.nome || contatoAtual.cpf}</h2>
                <div className="chat-subtitle">
                  {`Regiao: ${contatoAtual.regiao || contatoAtual.cidade || "Nao informada"}`}
                  {atendimentoAtual?.iniciadoEm ? ` • Atendimento iniciado: ${formatarDataHora(atendimentoAtual.iniciadoEm)}` : ""}
                </div>
              </>
            ) : null}
          </div>

          <div className="content-actions content-actions-top">
            <div className="panel-status-row">
              <div className="queue-summary-pill">
                <strong>{fila.length}</strong>
                <span>{fila.length === 1 ? "na fila" : "na fila"}</span>
              </div>
              <label className="field compact-field topbar-status-field">
                <span>Status</span>
                <select value={meuStatus} onChange={(e) => alterarStatus(e.target.value)}>
                  <option value="online">Online</option>
                  <option value="ausente">Ausente</option>
                </select>
              </label>
              <button className="secondary-button topbar-button mass-action-button" onClick={onGoToDisparo}>
                Disparo em massa
              </button>
              {user.role === "admin" ? (
                <button className="secondary-button topbar-button" onClick={onGoToAcompanhamento}>
                  Administrador
                </button>
              ) : null}
              <button className="secondary-button topbar-button finalize-action-button" onClick={finalizarConversa} disabled={!contatoEhAtivo}>
                Finalizar
              </button>
              <button className="ghost-button topbar-button" onClick={onBack}>
                Menu
              </button>
            </div>
            <button
              className="ghost-button"
              onClick={() => {
                setMostrarTransferencia((atual) => !atual);
                setDestinoTransferencia("");
              }}
              disabled={!contatoAtual}
            >
              Transferir
            </button>
          </div>
        </div>

        {mostrarTransferencia && contatoAtual ? (
          <div className="transfer-panel">
            <strong>Transferir conversa</strong>
            <div className="queue-meta">A lista mostra todos os atendentes, mas a transferencia so pode ir para quem estiver online.</div>
            <div className="transfer-inline">
              <label className="field compact-field transfer-select-field">
                <span>Destino</span>
                <select value={destinoTransferencia} onChange={(e) => setDestinoTransferencia(e.target.value)}>
                  <option value="">Selecione um atendente</option>
                  {opcoesTransferencia.map((item) => (
                    <option key={item.email} value={item.email}>
                      {item.nome} - {item.status}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button topbar-button"
                onClick={() => transferirPara(destinoTransferencia)}
                disabled={!destinoTransferenciaSelecionado || destinoTransferenciaSelecionado.disponibilidade !== "online"}
              >
                Confirmar
              </button>
            </div>
          </div>
        ) : null}

        <div className="chat-area" ref={chatAreaRef}>
          {!contatoAtual ? (
            <div className="empty-state">Selecione uma conversa para responder o entregador.</div>
          ) : (
            chat.map((item) => (
              <div className={`message ${item.from === user.email ? "mine" : ""}`} key={item.id}>
                <div className="message-actions">
                  {user.role === "admin" ? (
                    <button
                      className="icon-button"
                      onClick={() => apagarMensagem(item.id)}
                      disabled={apagandoId === item.id}
                      title="Apagar mensagem"
                    >
                      x
                    </button>
                  ) : null}
                </div>
                {item.text ? <div>{item.text}</div> : null}
                <MediaPreview media={item.media} />
                <div className="message-meta">
                  <span className="message-meta-label">
                    {item.from === user.email ? "Voce" : contatoAtual.nome || contatoAtual.cpf} - {formatarHora(item.createdAt)}
                  </span>
                  {item.from === user.email ? <StatusChecks message={item} /> : null}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="composer">
          <div className="composer-tools composer-tools-presets">
            {textosProntos.map((item) => (
              <button key={item.id || item.label} className="icon-pill preset-pill" onClick={() => setMsg(item.text)} disabled={!contatoAtual}>
                {item.label}
              </button>
            ))}
            <button className="icon-pill preset-manage-pill" onClick={abrirEditorTextos}>
              Editar atalhos
            </button>
          </div>
          {gravando ? (
            <div className="recording-shell panel-recording-shell">
              <button className="recording-cancel" onClick={cancelarGravacao} disabled={!contatoAtual}>
                Cancelar
              </button>
              <div className="recording-panel">
                <div className="recording-status">
                  <span className="recording-dot" />
                  <span>Gravando audio</span>
                </div>
                <div className="recording-wave">
                  {Array.from({ length: 22 }).map((_, index) => {
                    const alturas = [14, 18, 24, 16, 12, 20];
                    return <span key={`panel-rec-wave-${index}`} style={{ height: `${alturas[index % alturas.length]}px` }} />;
                  })}
                </div>
                <div className="recording-time">{formatarDuracao(tempoGravacao)}</div>
              </div>
              <button className="send-button recording-send" onClick={pararGravacao} disabled={!contatoAtual}>
                {">"}
              </button>
            </div>
          ) : (
            <>
              <div className="composer-tools composer-tools-actions">
                {emojisRapidos.map((emoji) => (
                  <button key={emoji} className="icon-pill" onClick={() => setMsg((atual) => `${atual}${emoji}`)} disabled={!contatoAtual}>
                    {emoji}
                  </button>
                ))}
                <button className="icon-pill" onClick={() => imageInputRef.current?.click()} disabled={!contatoAtual}>
                  Foto
                </button>
              </div>
              <input
                placeholder="Escreva uma mensagem..."
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    enviar();
                  }
                }}
                disabled={!contatoAtual}
              />
              <button className="send-button" onClick={enviar} disabled={!contatoAtual}>
                {">"}
              </button>
              <button
                className="send-button secondary-send audio-action-button"
                onClick={iniciarGravacao}
                disabled={!contatoAtual}
                title="Gravar audio"
              >
                <MicIcon />
              </button>
            </>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              enviarArquivo(file, "image");
              e.target.value = "";
            }}
          />
        </div>
      </main>

      <aside className="details-panel">
        <div className="details-header">
          <strong>Dados do contato</strong>
          <div className="tabs">
            <button className={`tab-button ${abaLateral === "perfil" ? "active" : ""}`} onClick={() => setAbaLateral("perfil")}>
              Perfil
            </button>
            <button className={`tab-button ${abaLateral === "historico" ? "active" : ""}`} onClick={() => setAbaLateral("historico")}>
              Historico
            </button>
          </div>
        </div>

        <div className="panel-section">
          {abaLateral === "perfil" ? (
            <>
              <div className="profile-card">
                <strong>Informacoes</strong>
                <div className="profile-grid" style={{ marginTop: 16 }}>
                  <label className="field">
                    <span>Nome</span>
                    <input value={perfil.nome} onChange={(e) => setPerfil((atual) => ({ ...atual, nome: e.target.value }))} disabled={!contatoAtual} />
                  </label>
                  <label className="field">
                    <span>CPF</span>
                    <input value={perfil.cpf} disabled />
                  </label>
                  <label className="field">
                    <span>Celular</span>
                    <input value={perfil.telefone} onChange={(e) => setPerfil((atual) => ({ ...atual, telefone: e.target.value }))} disabled={!contatoAtual} />
                  </label>
                  <label className="field">
                    <span>Cidade</span>
                    <input value={perfil.cidade} onChange={(e) => setPerfil((atual) => ({ ...atual, cidade: e.target.value }))} disabled={!contatoAtual} />
                  </label>
                  <label className="field">
                    <span>Hot zone</span>
                    <input value={perfil.hotZone} onChange={(e) => setPerfil((atual) => ({ ...atual, hotZone: e.target.value }))} disabled={!contatoAtual} />
                  </label>
                </div>
              </div>

              <div className="profile-card comments-card">
                <strong>Comentarios</strong>
                <label className="field" style={{ marginTop: 16 }}>
                  <textarea
                    placeholder="Escreva uma observacao..."
                    value={perfil.observacoes}
                    onChange={(e) => setPerfil((atual) => ({ ...atual, observacoes: e.target.value }))}
                    disabled={!contatoAtual}
                  />
                </label>

                <button className="secondary-button" onClick={salvar} disabled={!contatoAtual || salvando}>
                  {salvando ? "Salvando..." : "Salvar dados"}
                </button>
              </div>
            </>
          ) : (
            <div className="profile-card">
              <strong>Historico de atendimentos</strong>
              {historico.length === 0 ? (
                <p>Nenhum atendimento finalizado para este entregador.</p>
              ) : (
                <>
                  <div className="history-list">
                    {historico.map((item) => (
                      <button
                        type="button"
                        className={`history-card ${historicoAbertoId === item.id ? "active" : ""}`}
                        key={`${item.cpf}-${item.id}`}
                        onClick={() => setHistoricoAbertoId(item.id)}
                      >
                        <strong>Ticket #{item.id}</strong>
                        <div className="queue-meta">Encerrado por: {item.finalizadoPor?.nome || item.finalizadoPor?.email || "Nao informado"}</div>
                        <div className="queue-meta">Data/Hora: {formatarDataHora(item.finalizadoEm || item.iniciadoEm)}</div>
                      </button>
                    ))}
                  </div>

                  {historicoSelecionado ? (
                    <div className="history-card history-detail-card">
                      <strong>Conversa finalizada</strong>
                      <div className="queue-meta">Ticket: #{historicoSelecionado.id}</div>
                      <div className="queue-meta">Encerrado por: {historicoSelecionado.finalizadoPor?.nome || historicoSelecionado.finalizadoPor?.email || "Nao informado"}</div>
                      <div className="queue-meta">Data/Hora: {formatarDataHora(historicoSelecionado.finalizadoEm || historicoSelecionado.iniciadoEm)}</div>
                      {(historicoSelecionado.mensagens || []).length === 0 ? (
                        <div className="queue-meta" style={{ marginTop: 12 }}>
                          Nenhuma mensagem registrada nesse ticket.
                        </div>
                      ) : (
                        <div className="history-thread">
                          {(historicoSelecionado.mensagens || []).map((mensagem) => (
                            <div className="history-message" key={mensagem.id}>
                              <strong>
                                {mensagem.from.includes("@")
                                  ? mensagem.from
                                  : contatoAtual?.nome || historicoSelecionado.cpf}
                              </strong>
                              {mensagem.text ? <span>{mensagem.text}</span> : null}
                              <MediaPreview media={mensagem.media} />
                              <small>{formatarDataHora(mensagem.createdAt)}</small>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      {editorTextosAberto ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <strong>Mensagens prontas</strong>
                <div className="queue-meta">Essas mensagens ficam padronizadas para todos os atendentes.</div>
              </div>
              <button className="ghost-button" onClick={() => setEditorTextosAberto(false)}>
                Fechar
              </button>
            </div>

            <div className="preset-editor-list">
              {textosEditaveis.map((item) => (
                <div className="preset-editor-card" key={item.id}>
                  <label className="field">
                    <span>Titulo do botao</span>
                    <input
                      value={item.label}
                      onChange={(e) => atualizarTextoEditavel(item.id, "label", e.target.value)}
                      placeholder="Ex: Em analise"
                    />
                  </label>
                  <label className="field">
                    <span>Mensagem</span>
                    <textarea
                      value={item.text}
                      onChange={(e) => atualizarTextoEditavel(item.id, "text", e.target.value)}
                      placeholder="Digite a mensagem pronta"
                    />
                  </label>
                  <button className="ghost-button" onClick={() => removerTextoPronto(item.id)}>
                    Remover
                  </button>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="secondary-button" onClick={adicionarTextoPronto}>
                Adicionar mensagem
              </button>
              <button className="primary-button" onClick={salvarTextosProntos} disabled={salvandoTextos}>
                {salvandoTextos ? "Salvando..." : "Salvar mensagens"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Atendimento;

