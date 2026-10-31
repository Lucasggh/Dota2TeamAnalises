# 🛡️ Dota 2 Rival Scout & Draft Advisor (Coach Edition)

Aplicativo web para consultar e analisar o histórico de jogadores adversários de Dota 2 através da API pública do **OpenDota**. O objetivo é fornecer ao coach e capitão da equipe um relatório ágil, visual e com embasamento estatístico sobre os heróis mais jogados, taxas de vitória e o **Score de Confiança Ponderado** dos adversários para o próximo campeonato.

---

## 🚀 Como Executar Localmente

Você pode rodar este aplicativo de **duas maneiras extremamente simples**:

### Opção 1: Sem Servidor (Mais Rápido - 1 Clique)
Como a API do OpenDota possui cabeçalhos CORS liberados:
1. Basta dar um **duplo clique no arquivo `index.html`** (ou no atalho `iniciar.bat`).
2. O aplicativo abrirá imediatamente no seu navegador padrão (Chrome, Edge, Firefox, Brave, etc.).

### Opção 2: Com Servidor Local Node.js (Recomendado)
Se preferir rodar em um servidor web local com porta dedicada:
1. Abra o terminal nesta pasta.
2. Execute:
   ```bash
   node server.js
   ```
3. Abra no navegador: **`http://localhost:3000`**

*(Opcional com Python: execute `py server.py` ou `python server.py`)*

---

## 🔍 Como Obter o Account ID (Friend ID) do Adversário

O aplicativo necessita do **Account ID (SteamID32 / Friend ID)** do adversário:
1. **Dentro do Dota 2:** Vá no perfil do jogador ou passe o mouse no card de amigo. O Friend ID é o número exibido ao lado do avatar (ex: `70388657`).
2. **Pelo Dotabuff / Stratz / OpenDota:** Copie o link do jogador (ex: `https://www.dotabuff.com/players/70388657`) ou apenas os dígitos finais. O aplicativo aceita tanto o número direto quanto a URL completa!

> **Nota:** O jogador adversário precisa estar com o histórico público ativado nas opções do Dota 2 (*"Expor Dados Públicos de Partidas"*).

---

## 🧮 A Fórmula do "Score de Confiança" (Score Ponderado)

Para apoiar as decisões de **Ban & Pick** do coach, heróis com apenas 1 jogo e 100% de vitória não podem dominar o topo, e jogos jogados na semana passada devem pesar mais que jogos jogados há 8 meses.

O algoritmo avalia cada partida dentro da **janela dos últimos 9 meses** (~274 dias):

### 1. Fator de Recência da Partida ($w_i$)
Cada partida $i$ jogada há $d_i$ dias recebe um peso:
$$w_i = 0.40 + 0.60 \times \max\left(0, 1 - \frac{d_i}{274}\right)$$
- Partida jogada **hoje/esta semana**: peso $\approx 1.00$
- Partida jogada há **4.5 meses**: peso $\approx 0.70$
- Partida jogada há **9 meses**: peso $\approx 0.40$

### 2. Taxa de Vitória Ponderada ($WR_{pond}$)
$$V_{pond} = \sum w_i \quad \text{(Volume Ponderado)}$$
$$W_{pond} = \sum_{vitorias} w_i \quad \text{(Vitórias Ponderadas)}$$
$$WR_{pond} = \frac{W_{pond}}{V_{pond}} \times 100$$

### 3. Fator de Confiabilidade Estatística / Volume ($F_{vol}$)
Para proteger o coach contra pequenas amostras casuais (ex: heróis com 1 ou 2 jogos nunca mais recebem falsos positivos de alta confiança):
$$F_{vol} = \frac{N^2}{N^2 + 18}$$
- 1 partida: peso $\approx 0.05$ (Score travado em máx. 12 pts)
- 2 partidas: peso $\approx 0.18$ (Score travado em máx. 24 pts - **Amostra Baixa**)
- 3 partidas: peso $\approx 0.33$ (Score travado em máx. 38 pts - **Atenção**)
- 5 partidas: peso $\approx 0.58$
- 10 partidas: peso $\approx 0.85$ (Volume consistente)
- 15+ partidas: peso $\approx 0.93+$ (Volume de comfort pick/spammer)

### 4. Score de Confiança Final (0 a 100)
$$\text{Score} = \text{round}\left( WR_{pond} \times F_{vol} \times (0.70 + 0.30 \times \bar{R}) \times \text{FrequênciaPool} \times 1.15 \right)$$

#### Requisitos Rigorosos para os Tiers de Ban:
- 🔴 **BAN URGENTE (Tier S):** Mínimo de **6 partidas**, Winrate $\ge 55\%$ e Score $\ge 52$. Ameaça máxima.
- 🟠 **RISCO ALTO (Tier A):** Mínimo de **4 partidas**, Winrate $\ge 50\%$ e Score $\ge 38$. Pick perigoso a respeitar.
- 🟡 **ATENÇÃO (Tier B):** Mínimo de **3 partidas** e Score $\ge 25$, ou 5+ partidas estáveis.
- ⚪ **AMOSTRA BAIXA / SECUNDÁRIO (Tier C):** Heróis com 1 ou 2 jogos (ou Score $< 25$). Jamais entram no Top 3 de sugestão de ban.

---

## 👑 Filtro de Posições 1-5 (Role Scouting)
O aplicativo conta com mapeamento competitivo dos 127 heróis para as **5 posições oficiais do Dota 2**:
- 👑 **Pos 1:** Hard Carry (Safe Lane Core)
- ⚡ **Pos 2:** Mid Laner (Mid Core)
- 🛡️ **Pos 3:** Offlaner (Off Lane Core / Initiator)
- 🎯 **Pos 4:** Soft Support (Semi-Suporte / Roamer)
- 🩸 **Pos 5:** Hard Support (Suporte Total / Saver)

Ao clicar nas **Pills de Posição**, o Coach pode filtrar tanto a tabela quanto as **Sugestões de Ban** especificamente para a lane ou função que deseja anular no draft!

---

## 📊 Recursos da Interface para o Coach

1. **Dashboard de Scouting Instantâneo:**
   - Foto oficial da Steam, Nickname e Medalha/Rank Imortal do adversário.
   - Links diretos para Dotabuff, OpenDota e Stratz.
2. **4 Cards de Resumo Rápido:**
   - 🚫 **Sugestão de Bans (Top 3):** Os heróis com maior pontuação de ameaça.
   - 🎯 **Mais Spammado:** O herói com maior repetição no período.
   - 🔥 **Maior Winrate:** Melhor taxa de vitória com volume confiável.
   - 📊 **Panorama Geral:** Volume total, winrate médio e tamanho da hero pool.
3. **Tabela Principal Interativa:**
   - Ranking com posição, avatar oficial do herói, tag de atributo primário (STR, AGI, INT, UNI).
   - Volume de jogos e porcentagem correspondente da pool do jogador.
   - Vitórias e Derrotas com barra de winrate visual e colorida.
   - Tempo relativo da última partida jogada ("Hoje", "há 3 dias", "há 2 semanas").
   - Link para abrir modal detalhado com todas as partidas do herói (KDA, duração e resultado).
4. **Exportação & Compartilhamento:**
   - 📋 **"Copiar para Discord/WhatsApp":** Gera um relatório em texto perfeito para colar na call ou no canal da equipe com os top bans recomendados.
   - 📥 **Exportar CSV:** Gera arquivo compatível com Excel/Google Sheets.
   - 🖨️ **Imprimir/PDF:** Layout otimizado para levar em formato impresso para a cabine de draft.

---

## 🛠️ Tecnologias Utilizadas
- **HTML5 & JavaScript ES6 Puro** (Zero dependências pesadas, sem necessidade de build/compilação).
- **Tailwind CSS** (via CDN com visual moderno inspirado na estética esports do Dota 2).
- **OpenDota API** pública (`/players/{id}`, `/players/{id}/matches`, `/heroes`).
- **Steam CDN** oficial para imagens em alta qualidade dos heróis.
