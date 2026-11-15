/**
 * Baixa um valor como arquivo JSON pelo navegador: `Blob` + link temporário com `download`. Sem
 * `data:` (a CSP só os aceita em imagens) e sem abrir janela; a URL do blob é liberada em seguida.
 */
export function downloadJson(filename: string, data: unknown, doc: Document = document): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = doc.createElement('a')
  link.href = url
  link.download = filename
  link.hidden = true
  doc.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    // O clique já entregou o blob ao gerenciador de downloads; liberar no próximo ciclo é seguro.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
