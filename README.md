# Graphe

Uma alternativa moderna ao [theWord](https://www.theword.net/) para estudo bíblico, construída com Electron.

O Graphe oferece uma interface limpa e atual para leitura, pesquisa e análise profunda das Escrituras, com suporte a painéis divididos, números de Strong, referências cruzadas e múltiplas traduções.

Disponível para **Windows**, **Linux** e **macOS**.

## Funcionalidades

### Traduções Bíblicas
- Suporte a múltiplas traduções abertas simultaneamente
- Sistema de painéis divididos (horizontal e vertical) para comparar traduções lado a lado
- Navegação rápida por livro, capítulo e versículo

### Números de Strong
- Exibição dos números de Strong (Hebraico e Grego) integrados ao texto bíblico
- Consulta a dicionários de Strong com um clique
- Suporte a múltiplos dicionários (Almeida, Strong-PT, BDB)
- Pesquisa por número de Strong (ex: `strong:H1234`)
- Exibição de cognatos e palavras relacionadas

### Referências Cruzadas
- Integração com o Treasury of Scripture Knowledge (TSK)
- Navegação direta para versículos referenciados
- Suporte a múltiplos módulos de referências cruzadas

### Compatibilidade com Módulos do theWord
- Importa e utiliza módulos no formato SQLite3 do theWord
- Suporte a módulos de Bíblias, Dicionários e Referências Cruzadas
- O tipo do módulo é detectado automaticamente a partir da estrutura do banco de dados

#### Instalando módulos

Copie os arquivos `.SQLite3` para a pasta de módulos:

```
~/.graphe/modules/
```

Exemplos de nomes de arquivos:

| Tipo | Exemplo |
|------|---------|
| Bíblia | `ACF+.SQLite3` |
| Dicionário | `Strong-PT.dictionary.SQLite3` |
| Referências Cruzadas | `TSK-x.crossreferences.SQLite3` |

Reinicie o app após adicionar novos módulos.

### Pesquisa
- Busca textual em todos os versículos
- Busca por números de Strong
- Busca semântica com IA (experimental) — encontra versículos por significado, não apenas por palavras

### Interface
- Temas claro e escuro
- Tamanho de fonte ajustável
- Disponível em Português, Inglês e Espanhol
- Seleção e cópia de versículos com `Ctrl+C`
- Atalhos de teclado para navegação rápida

## Limitações

- Comentários bíblicos ainda **não** são suportados

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
