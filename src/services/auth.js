import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import * as tokensRepository from '../repositories/tokens.js';
import * as usuariosRepository from '../repositories/usuarios.js';
import { conflict, notFound, unauthorized } from '../utils/errors.js';
import { emitirSesion, revocarRefreshToken, rotarRefreshToken } from './tokens.js';

// Hash de una contraseña cualquiera: si el email no existe igual se compara contra algo,
// así el tiempo de respuesta no revela qué emails están registrados.
const HASH_FALSO = bcrypt.hashSync('contraseña-que-no-existe', config.BCRYPT_ROUNDS);

export async function registrar({ nombre, apellido, email, password }) {
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

  return withTransaction(async (client) => {
    const usuario = await usuariosRepository.crear({ nombre, apellido, email, passwordHash }, client);
    if (!usuario) throw conflict('Ya existe una cuenta con ese email');
    return { usuario, ...(await emitirSesion(usuario, client)) };
  });
}

export async function login(email, password) {
  const usuario = await usuariosRepository.buscarPorEmailConHash(email);
  const ok = await bcrypt.compare(password, usuario?.password_hash ?? HASH_FALSO);
  if (!usuario || !ok) throw unauthorized('Email o contraseña incorrectos');

  delete usuario.password_hash;
  return { usuario, ...(await emitirSesion(usuario)) };
}

export async function refrescar(refreshToken) {
  const resultado = await rotarRefreshToken(refreshToken);
  if (resultado.reuso) throw unauthorized('Refresh token reutilizado: se cerraron todas tus sesiones');
  return resultado.sesion;
}

export const logout = (refreshToken) => revocarRefreshToken(refreshToken);

// ---------- Perfil del usuario logueado ----------

export async function obtenerPerfil(usuarioId) {
  const usuario = await usuariosRepository.buscarPorId(usuarioId);
  if (!usuario) throw notFound('Usuario no encontrado');
  return usuario;
}

export const actualizarPerfil = (usuarioId, datos) => usuariosRepository.actualizarPerfil(usuarioId, datos);

async function passwordCorrecta(usuarioId, password) {
  const hash = await usuariosRepository.obtenerPasswordHash(usuarioId);
  return Boolean(hash) && bcrypt.compare(password, hash);
}

export async function cambiarPassword(usuarioId, actual, nueva) {
  if (!(await passwordCorrecta(usuarioId, actual))) throw unauthorized('La contraseña actual no es correcta');

  const nuevoHash = await bcrypt.hash(nueva, config.BCRYPT_ROUNDS);
  await withTransaction(async (client) => {
    await usuariosRepository.actualizarPassword(usuarioId, nuevoHash, client);
    // Cambiar la contraseña cierra todas las sesiones abiertas
    await tokensRepository.revocarTodos(usuarioId, client);
  });
}

export async function borrarCuenta(usuarioId, password) {
  if (!(await passwordCorrecta(usuarioId, password))) throw unauthorized('Contraseña incorrecta');
  await usuariosRepository.borrar(usuarioId);
}
