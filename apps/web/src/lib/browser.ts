/**
 * Navegação completa do documento (não a do roteador do Next): sair, excluir a conta e ir para o
 * provedor OAuth trocam de página de verdade, o que também descarta o cache de consultas.
 * Fica num módulo próprio para os testes de componente trocarem por um espião.
 */
export function navigateTo(url: string): void {
  window.location.assign(url)
}
