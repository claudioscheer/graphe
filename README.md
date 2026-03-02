# Graphe

Uma alternativa moderna e muito simplificada ao [theWord](https://www.theword.net/) para estudo bíblico.

O Graphe oferece uma interface limpa e atual para leitura, pesquisa e análise profunda das Escrituras, com suporte a painéis divididos, números de Strong, referências cruzadas e múltiplas traduções.

Disponível para **Windows**, **Linux** e **macOS**.

## Download

Baixe a versão mais recente para o seu sistema operacional na página de [releases](https://github.com/claudioscheer/graphe/releases/latest).

## Funcionalidades

### Traduções Bíblicas

- Suporte a múltiplas traduções abertas simultaneamente
- Sistema de painéis divididos (horizontal e vertical) para comparar traduções lado a lado
- Navegação rápida por livro, capítulo e versículo

### Números de Strong

- Exibição dos números de Strong (Hebraico e Grego) integrados ao texto bíblico
- Consulta a dicionários de Strong com um clique
- Suporte a múltiplos dicionários (Almeida, Strong-PT, BDB)
- Exibição de cognatos e palavras relacionadas

### Referências Cruzadas

- Integração com o Treasury of Scripture Knowledge (TSK)
- Navegação direta para versículos referenciados
- Suporte a múltiplos módulos de referências cruzadas
- Opção de abrir referências em modal de prévia (painel fixado)

### Comentários Bíblicos

- Suporte a módulos de comentário (ex: Matthew Henry, Jamieson-Fausset-Brown)
- Visualização sincronizada com o texto bíblico — o comentário acompanha o capítulo aberto
- Abertura em painel dividido (horizontal ou vertical)
- Vinculação flexível: escolha qual painel bíblico atualiza cada comentário

### Compatibilidade com Módulos do theWord

- Importa e utiliza módulos no formato SQLite3 do theWord
- Suporte a módulos de Bíblias, Dicionários, Referências Cruzadas e Comentários
- O tipo do módulo é detectado automaticamente a partir da estrutura do banco de dados

#### Instalando módulos

Copie os arquivos `.SQLite3` para a pasta de módulos do Graphe:

| Sistema  | Caminho                          |
| -------- | -------------------------------- |
| Linux    | `~/.graphe/modules/`            |
| macOS    | `~/.graphe/modules/`            |
| Windows  | `%USERPROFILE%\.graphe\modules\` |

O tipo do módulo (Bíblia, Dicionário, Referências Cruzadas ou Comentário) é detectado automaticamente a partir das tabelas no banco de dados.

Após copiar os módulos, reinicie o app e acesse as **Configurações** para verificar e organizar os módulos instalados.

### Pesquisa

- Busca textual em todos os versículos
- Busca por números de Strong (ex: `strong:H1234`)

### Interface

- Temas claro e escuro
- Tamanho de fonte ajustável
- Disponível em Português, Inglês e Espanhol
- Seleção e cópia de versículos com `Ctrl+C`
- Atalhos de teclado para navegação rápida

## Problemas ou Sugestões

Encontrou um bug ou tem uma ideia para melhorar o Graphe? Abra uma issue no [GitHub](https://github.com/claudioscheer/graphe/issues).

## Desenvolvimento

### Pré-requisitos

- Node.js
- npm

### Instalação

```bash
npm install
```

### Executar em modo de desenvolvimento

```bash
npm run dev
```

### Gerar pacote

```bash
npm run make
```

## Licença

MIT
