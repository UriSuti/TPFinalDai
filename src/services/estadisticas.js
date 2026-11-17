import * as estadisticasRepository from '../repositories/estadisticas.js';

const ESTADOS = ['quiero_escuchar', 'escuchando', 'escuchado'];

// Arma todas las estadísticas de la biblioteca en una sola respuesta.
export async function obtenerEstadisticas(usuarioId) {
  const [estados, totales, resenas, distribucion, topArtistas, topGeneros, mejorPuntuadas, porMes, diasActivos] =
    await Promise.all([
      estadisticasRepository.porEstado(usuarioId),
      estadisticasRepository.totales(usuarioId),
      estadisticasRepository.resenas(usuarioId),
      estadisticasRepository.distribucionPuntuaciones(usuarioId),
      estadisticasRepository.topArtistas(usuarioId),
      estadisticasRepository.topGeneros(usuarioId),
      estadisticasRepository.mejorPuntuadas(usuarioId),
      estadisticasRepository.actividadPorMes(usuarioId),
      estadisticasRepository.diasActivos(usuarioId),
    ]);

  // Los estados sin canciones también van, con 0
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  for (const fila of estados) porEstado[fila.estado] = fila.cantidad;
  const enBiblioteca = ESTADOS.reduce((suma, e) => suma + porEstado[e], 0);

  return {
    biblioteca: {
      total: enBiblioteca,
      porEstado,
      // Qué parte de la biblioteca ya se escuchó (avance)
      porcentajeEscuchado: enBiblioteca ? Math.round((100 * porEstado.escuchado) / enBiblioteca) : 0,
      escuchadasEsteAnio: totales.escuchadas_este_anio,
      artistasDistintos: totales.artistas_distintos,
    },
    favoritos: totales.favoritos,
    playlists: {
      total: totales.playlists,
      canciones: totales.canciones_en_playlists,
    },
    resenas: {
      total: resenas.total,
      puntuadas: resenas.puntuadas,
      conComentario: resenas.con_comentario,
      promedio: resenas.promedio,
      distribucion,
    },
    topArtistas,
    topGeneros,
    mejorPuntuadas,
    actividad: {
      porMes,
      diasActivosUltimos30: diasActivos,
    },
  };
}
