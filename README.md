# ISP Guard v2

Extensão para navegador que bloqueia acesso a domínios especificados quando você não está na sua rede residencial.

## Funcionalidades

- ✅ Proteção baseada em IP (IPv4 e/ou IPv6)
- ✅ Proteção baseada em ISP
- ✅ Modo IP dinâmico (verifica apenas ISP)
- ✅ Suporte a conexões IPv6-only
- ✅ Suporte a dual-stack (IPv4 + IPv6)
- ✅ Interface em Português (pt-BR)
- ✅ Dados codificados em Base64 (privacidade)

## Como Usar

1. **Instale a extensão** no seu navegador Chrome/Edge
2. **Clique no ícone da extensão** para abrir as configurações
3. **Configure os domínios** que deseja proteger (um por linha)
4. **Clique em "Detectar Rede Atual"** para identificar sua rede residencial
5. **Salve as configurações**

### Modos de Operação

#### Modo IP Estático (padrão)
- Verifica **ISP + IP** (IPv4 e/ou IPv6)
- Use quando seu IP residencial é fixo
- Recomendado para maior segurança

#### Modo IP Dinâmico
- Verifica **apenas ISP**
- Marque "Meu IP é dinâmico" nas configurações
- Use quando seu provedor muda seu IP frequentemente

## Lógica de Validação de IP

### Cenário 1: Apenas IPv4 salvo
- ✅ **Permite**: IPv4 atual = IPv4 salvo (ignora IPv6 detectado)
- ❌ **Bloqueia**: IPv4 atual ≠ IPv4 salvo

### Cenário 2: Apenas IPv6 salvo
- ✅ **Permite**: IPv6 atual = IPv6 salvo (ignora IPv4 detectado)
- ❌ **Bloqueia**: IPv6 atual ≠ IPv6 salvo

### Cenário 3: IPv4 e IPv6 salvos
- ✅ **Permite**: IPv4 atual = IPv4 salvo **OU** IPv6 atual = IPv6 salvo
- ❌ **Bloqueia**: Nenhum IP corresponde

### Cenário 4: VPN apenas IPv6
Se você salvou IPv4 + IPv6 residenciais, mas está usando VPN que só fornece IPv6:
- ❌ **Bloqueia**: IPv6 da VPN ≠ IPv6 residencial
- ✅ **Correto**: Protege mesmo com VPN IPv6-only

## Exemplos de Uso

### Proteger PayPal e Banco
```
paypal.com
itau.com.br
bb.com.br
```

### Proteção Adicional
- A extensão verifica **antes de carregar a página**
- Funciona mesmo em abas anônimas
- Dados sensíveis não são expostos na URL (Base64)

## Arquitetura Técnica

- **Manifest V3** compatível
- **Service Worker** para background
- **webNavigation API** para interceptação
- **Multiple IP APIs** para detecção confiável
- **CSP compliant** (sem scripts inline)

## Privacidade

- Todos os dados são armazenados **localmente**
- IPs são codificados em **Base64** nas URLs internas
- Nenhum dado é enviado para servidores externos (exceto APIs de detecção de IP)

## Desenvolvimento

### Estrutura de Arquivos
```
ispguard/
├── manifest.json       # Configuração da extensão
├── background.js       # Lógica de verificação de rede
├── options.html        # Interface de configurações
├── options.js          # Lógica da interface
├── blocked.html        # Página de bloqueio
├── blocked.js          # Lógica da página de bloqueio
└── style.css          # Estilos
```

### APIs Utilizadas
- `ipwho.is` - IPv4 + ISP
- `ipapi.co` - IPv4 + ISP (fallback)
- `ifconfig.co` - IPv4 + ISP (fallback)
- `api64.ipify.org` - IPv6
- `api.ipify.org` - IPv6 (fallback)

## Licença

Uso pessoal
