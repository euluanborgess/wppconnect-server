/*
 * Copyright 2021 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permclearSessionissions and
 * limitations under the License.
 */
import { Message, Whatsapp } from '@wppconnect-team/wppconnect';
import fs from 'fs';
import mime from 'mime-types';
import QRCode from 'qrcode';
import { Logger } from 'winston';

import { version } from '../../package.json';
import config from '../config';
import { Request } from '../types/Request';
import CreateSessionUtil from '../util/createSessionUtil';
import { callWebHook, contactToArray } from '../util/functions';
import getAllTokens from '../util/getAllTokens';
import { clientsArray } from '../util/sessionUtil';

const SessionUtil = new CreateSessionUtil();

async function downloadFileFunction(
  message: Message,
  client: Whatsapp,
  logger: Logger
) {
  try {
    const buffer = await client.decryptFile(message);

    const filename = `./WhatsAppImages/file${message.t}`;
    if (!fs.existsSync(filename)) {
      let result = '';
      if (message.type === 'ptt') {
        result = `${filename}.oga`;
      } else {
        result = `${filename}.${mime.extension(message.mimetype)}`;
      }

      await fs.writeFile(result, buffer, (err) => {
        if (err) {
          logger.error(err);
        }
      });

      return result;
    } else {
      return `${filename}.${mime.extension(message.mimetype)}`;
    }
  } catch (e) {
    logger.error(e);
    logger.warn(
      'Erro ao descriptografar a midia, tentando fazer o download direto...'
    );
    try {
      const buffer = await client.downloadMedia(message);
      const filename = `./WhatsAppImages/file${message.t}`;
      if (!fs.existsSync(filename)) {
        let result = '';
        if (message.type === 'ptt') {
          result = `${filename}.oga`;
        } else {
          result = `${filename}.${mime.extension(message.mimetype)}`;
        }

        await fs.writeFile(result, buffer, (err) => {
          if (err) {
            logger.error(err);
          }
        });

        return result;
      } else {
        return `${filename}.${mime.extension(message.mimetype)}`;
      }
    } catch (e) {
      logger.error(e);
      logger.warn('Não foi possível baixar a mídia...');
    }
  }
}

export async function download(message: any, client: any, logger: any) {
  try {
    const path = await downloadFileFunction(message, client, logger);
    return path?.replace('./', '');
  } catch (e) {
    logger.error(e);
  }
}

export async function startAllSessions() {
  try {
    if (!config.startAllSession) {
      console.info('StartAllSession is disabled in config');
      return;
    }

    const tokensDir = config.customUserDataDir;

    // Check if tokens directory exists
    if (!fs.existsSync(tokensDir)) {
      console.info('Tokens directory does not exist, creating it...');
      fs.mkdirSync(tokensDir, { recursive: true });
      return;
    }

    const sessions = fs
      .readdirSync(tokensDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    if (sessions.length === 0) {
      console.info('No sessions found to start');
      return;
    }

    console.info(`Found ${sessions.length} sessions to start`);

    for (const session of sessions) {
      try {
        // Check if session has valid token file
        const tokenPath = path.join(tokensDir, session, 'session.data.json');
        if (!fs.existsSync(tokenPath)) {
          console.warn(`Session ${session} has no token file, skipping...`);
          continue;
        }

        console.info(`Starting session: ${session}`);

        const response = await axios.post(
          `${config.host}:${config.port}/api/${session}/start-session`,
          {},
          {
            timeout: 30000,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        console.info(`Session ${session} started successfully`);
      } catch (error) {
        if (error.response?.status === 404) {
          console.warn(
            `Session ${session} endpoint not found, might need manual start`
          );
        } else if (error.code === 'ECONNREFUSED') {
          console.error(
            `Connection refused for session ${session}, server might not be ready`
          );
        } else {
          console.error(`Failed to start session ${session}:`, error.message);
        }
        // Continue with other sessions instead of failing completely
        continue;
      }
    }

    console.info('Finished attempting to start all sessions');
  } catch (error) {
    console.error('Error in startAllSessions:', error.message);
    // Don't throw the error, just log it
  }
}

export async function showAllSessions(req: Request, res: any) {
  const { secretkey } = req.params;
  const { authorization: token } = req.headers;

  let tokenDecrypt: any = '';

  if (secretkey === undefined) {
    tokenDecrypt = token?.split(' ')[0];
  } else {
    tokenDecrypt = secretkey;
  }

  const arr: any = [];

  if (tokenDecrypt !== req.serverOptions.secretKey) {
    return res.status(400).json({
      response: false,
      message: 'The token is incorrect',
    });
  }

  Object.keys(clientsArray).forEach((item) => {
    arr.push({ session: item });
  });

  return res.status(200).json({ response: arr });
}

export async function startSession(req: Request, res: any) {
  const session = req.session;
  const { waitQrCode = false } = req.body;

  await getSessionState(req, res);
  await SessionUtil.opendata(req, session, waitQrCode ? res : null);
}

export async function closeSession(req: Request, res: any) {
  const session = req.session;
  const { clearSession = false } = req.body;
  try {
    if ((clientsArray as any)[session].status === null) {
      return await res
        .status(200)
        .json({ status: true, message: 'Session successfully closed' });
    } else {
      (clientsArray as any)[session] = { status: null };

      if (clearSession) {
        const sessionFolder = `${config.customUserDataDir}/${session}`;
        if (fs.existsSync(sessionFolder)) {
          console.log('Deletando pasta: ' + sessionFolder);
          fs.rmdirSync(sessionFolder, { recursive: true });
        }
      }
      await req.client.close();
      req.io.emit('whatsapp-status', false);
      callWebHook(req.client, req, 'closesession', {
        message: `Session: ${session} disconnected`,
        connected: false,
      });

      return await res
        .status(200)
        .json({ status: true, message: 'Session successfully closed' });
    }
  } catch (error) {
    req.logger.error(error);
    return await res
      .status(500)
      .json({ status: false, message: 'Error closing session', error });
  }
}

export async function logOutSession(req: Request, res: any) {
  try {
    const session = req.session;
    await req.client.logout();

    req.io.emit('whatsapp-status', false);
    callWebHook(req.client, req, 'logoutsession', {
      message: `Session: ${session} logged out`,
      connected: false,
    });

    return await res
      .status(200)
      .json({ status: true, message: 'Session successfully closed' });
  } catch (error) {
    req.logger.error(error);
    return await res
      .status(500)
      .json({ status: false, message: 'Error closing session', error });
  }
}

export async function checkConnectionSession(req: Request, res: any) {
  try {
    await req.client.isConnected();

    return res.status(200).json({ status: true, message: 'Connected' });
  } catch (error) {
    return res.status(200).json({ status: false, message: 'Disconnected' });
  }
}

export async function downloadMediaByMessage(req: Request, res: any) {
  const client = req.client;
  const { messageId } = req.body;

  let message;

  try {
    if (!messageId.isMedia || !messageId.type) {
      message = await client.getMessageById(messageId);
    } else {
      message = messageId;
    }

    if (!message)
      return res.status(400).json({
        status: 'error',
        message: 'Message not found',
      });

    if (!(message['mimetype'] || message.isMedia || message.isMMS))
      return res.status(400).json({
        status: 'error',
        message: 'Message does not contain media',
      });

    const buffer = await client.decryptFile(message);

    return res
      .status(200)
      .json({ base64: buffer.toString('base64'), mimetype: message.mimetype });
  } catch (e) {
    req.logger.error(e);
    return res.status(400).json({
      status: 'error',
      message: 'Decrypt file error',
      error: e,
    });
  }
}

export async function getMediaByMessage(req: Request, res: any) {
  const client = req.client;
  const { messageId } = req.params;

  try {
    const message = await client.getMessageById(messageId);

    if (!message)
      return res.status(400).json({
        status: 'error',
        message: 'Message not found',
      });

    if (!(message['mimetype'] || message.isMedia || message.isMMS))
      return res.status(400).json({
        status: 'error',
        message: 'Message does not contain media',
      });

    const buffer = await client.decryptFile(message);

    return res
      .status(200)
      .json({ base64: buffer.toString('base64'), mimetype: message.mimetype });
  } catch (ex) {
    req.logger.error(ex);
    return res.status(500).json({
      status: 'error',
      message: 'The session is not active',
      error: ex,
    });
  }
}

export async function getSessionState(req: Request, res: any) {
  try {
    const { waitQrCode = false } = req.body;
    const client = req.client;
    const qr =
      client?.urlcode != null && client?.urlcode != ''
        ? await QRCode.toDataURL(client.urlcode)
        : null;

    if ((client == null || client.status == null) && !waitQrCode)
      return res.status(200).json({ status: 'CLOSED', qrcode: null });
    else if (client != null)
      return res.status(200).json({
        status: client.status,
        qrcode: qr,
        urlcode: client.urlcode,
        version: version,
      });
  } catch (ex) {
    req.logger.error(ex);
    return res.status(500).json({
      status: 'error',
      message: 'The session is not active',
      error: ex,
    });
  }
}

export async function getQrCode(req: Request, res: any) {
  try {
    if (req.client.urlcode) {
      const qr = req.client.urlcode
        ? await QRCode.toDataURL(req.client.urlcode)
        : null;
      const img = Buffer.from(
        (qr as any).replace(/^data:image\/(png|jpeg|jpg);base64,/, ''),
        'base64'
      );

      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': img.length,
      });
      res.end(img);
    } else {
      return res.status(200).json({
        status: req.client.status,
        message: 'QRCode is not available...',
      });
    }
  } catch (ex) {
    req.logger.error(ex);
    return res
      .status(500)
      .json({ status: 'error', message: 'Error retrieving QRCode', error: ex });
  }
}

export async function killServiceWorker(req: Request, res: any) {
  try {
    return res
      .status(200)
      .json({ status: 'error', response: 'Not implemented yet' });
  } catch (ex) {
    req.logger.error(ex);
    return res.status(500).json({
      status: 'error',
      message: 'The session is not active',
      error: ex,
    });
  }
}

export async function restartService(req: Request, res: any) {
  try {
    return res
      .status(200)
      .json({ status: 'error', response: 'Not implemented yet' });
  } catch (ex) {
    req.logger.error(ex);
    return res.status(500).json({
      status: 'error',
      response: { message: 'The session is not active', error: ex },
    });
  }
}

export async function subscribePresence(req: Request, res: any) {
  try {
    const { phone, isGroup = false, all = false } = req.body;

    if (all) {
      let contacts;
      if (isGroup) {
        const groups = await req.client.getAllGroups(false);
        contacts = groups.map((p: any) => p.id._serialized);
      } else {
        const chats = await req.client.getAllContacts();
        contacts = chats.map((c: any) => c.id._serialized);
      }
      await req.client.subscribePresence(contacts);
    } else
      for (const contato of contactToArray(phone, isGroup)) {
        await req.client.subscribePresence(contato);
      }

    return await res.status(200).json({
      status: 'success',
      response: { message: 'Subscribe presence executed' },
    });
  } catch (error) {
    return await res.status(500).json({
      status: 'error',
      message: 'Error on subscribe presence',
      error: error,
    });
  }
}
