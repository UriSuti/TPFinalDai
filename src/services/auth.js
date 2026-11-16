import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import * as tokensRepository from '../repositories/tokens.js';
import * as usuariosRepository from '../repositories/usuarios.js';
import { conflict, notFound, unauthorized } from '../utils/errors.js';
import { emitirSesion, firmarAccessToken, revocarRefreshToken, rotarRefreshToken } from './tokens.js';

// Hash de una contraseña cualquiera: si el email no existe igual se compara contra algo,
// así el tiempo de respuesta no revela qué emails están registrados.
const HASH_FALSO = bcrypt.hashSync('contraseña-que-no-existe', config.BCRYPT_ROUNDS);

// Modo 'cookie' (navegador): solo el JWT; la sesión termina cuando vence. No se emite refresh
// token para no dejar en la base uno que nadie va a usar. Modo 'tokens': access + refresh.
const crearSesion = (usuario, modo, db) => (
  modo === 'tokens' ? emitirSesion(usuario, db) : { accessToken: firmarAccessToken(usuario) }
);

// Traduce el UNIQUE violado a un mensaje que el usuario entienda.
function conflictoDeUsuario(err) {
  if (err.code !== '23505') return err;
  if (err.constraint === 'usuarios_email_uq') return conflict('Ya existe una cuenta con ese email');
  if (err.constraint === 'usuarios_nombre_usuario_uq') return conflict('Ese nombre de usuario ya está en uso');
  return err;
}

export async function registrar({ nombre_usuario: nombreUsuario, nombre, apellido, email, password }, modo) {
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

  try {
    return await withTransaction(async (client) => {
      const usuario = await usuariosRepository.crear({ nombreUsuario, nombre, apellido, email, passwordHash }, client);
      return { usuario, ...(await crearSesion(usuario, modo, client)) };
    });
  } catch (err) {
    throw conflictoDeUsuario(err);
  }
}

export async function login(email, password, modo) {
  const usuario = await usuariosRepository.buscarPorEmailConHash(email);
  const ok = await bcrypt.compare(password, usuario?.password_hash ?? HASH_FALSO);
  if (!usuario || !ok) throw unauthorized('Email o contraseña incorrectos');

  delete usuario.password_hash;
  return { usuario, ...(await crearSesion(usuario, modo)) };
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

export async function actualizarPerfil(usuarioId, datos) {
  try {
    return await usuariosRepository.actualizarPerfil(usuarioId, datos);
  } catch (err) {
    throw conflictoDeUsuario(err);
  }
}

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
