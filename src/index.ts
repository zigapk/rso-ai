import * as dotenv from "dotenv";
import fastifyOpenapiDocs from "fastify-openapi-docs";
import OpenAI from "openai";
import pino from "pino";

dotenv.config();

// log to axiom and console
const logger = pino(
  { level: "info" },
  pino.transport({
    target: "@axiomhq/pino",
    options: {
      dataset: process.env.AXIOM_DATASET,
      token: process.env.AXIOM_TOKEN,
    },
  })
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

import Fastify from "fastify";

const server = Fastify({ logger });

server.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  function (req, body, done) {
    var json = JSON.parse(body as string);
    done(null, json);
  }
);

await server.register(fastifyOpenapiDocs, {
  openapi: {
    openapi: "3.0.3",
    info: {
      title: "RSO AI Microservice",
      description: "Handles advanced AI translation.",
      contact: {
        version: "1.0.0",
      },
    },
  },
});

server.addSchema({
  type: "object",
  $id: "request",
  description: "The request payload",
  properties: {
    languageFrom: {
      type: "string",
      description: "The language to translate from",
      pattern: "^.+$",
    },
    languageTo: {
      type: "string",
      description: "The language to translate to",
      pattern: "^.+$",
    },
    strings: {
      type: "array",
      description: "List of key-value pairs to translate",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The key to translate",
          },
          value: {
            type: "string",
            description: "The value to translate",
          },
        },
      },
    },
  },
  required: ["languageFrom", "languageTo"],
  additionalProperties: false,
});

server.addSchema({
  type: "object",
  $id: "response",
  description: "The response payload",
  properties: {
    strings: {
      type: "array",
      description: "List of key-value pairs translated",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The key translated",
          },
          value: {
            type: "string",
            description: "The value translated",
          },
          comment: {
            type: "string",
            description: "Comments where applicable",
          },
        },
      },
    },
  },
  required: ["strings"],
  additionalProperties: false,
});

interface PostParams {
  languageFrom: string;
  languageTo: string;
  strings: {
    key: string;
    value: string;
  }[];
}

// Health check response (GET /)
server.addSchema({
  type: "object",
  $id: "healthcheck",
  description: "The healthcheck response",
  properties: {
    status: {
      type: "string",
      description: "The status of the service",
    },
  },
});

server.route({
  method: "POST",
  url: "/translate",
  schema: {
    body: { $ref: "request#" },
    response: {
      200: { $ref: "response#" },
    },
  },
  config: {
    openapi: {
      description: "Translate strings",
      summary: "Translate strings",
    },
  },
  handler: async (req, res) => {
    // TODO: verify API key

    const { languageFrom, languageTo, strings } = req.body as PostParams;

    const stringsJoined = JSON.stringify(strings, null, 2);

    const prompt = `Translate the following strings from ${languageFrom} to ${languageTo}. Return them in the exact same format, but translated. You can add \`comment\` field to strings where you are not absolutely sure about the translation. Like this:\n\`\`\`{ "key": "value", "value": "translated value", "comment": "not sure about this one because of a specific reason" }\`\`\`\n\nReturn absolutely nothing but the json itself, it will be directly parsed by a program.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: stringsJoined,
        },
      ],
      temperature: 0.8,
      max_tokens: 4096,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const data = response.choices[0].message.content;

    return {
      strings: JSON.parse(data ?? ""),
    };
  },
});

// Healthcheck (checks if openai is reachable)
server.route({
  method: "GET",
  url: "/healthcheck",
  schema: {
    response: {
      200: { $ref: "healthcheck#" },
    },
  },
  config: {
    openapi: {
      description: "Healthcheck",
      summary: "Healthcheck",
    },
  },
  handler: async (req, res) => {
    try {
      await openai.files.list();
      return { status: "ok" };
    } catch (e) {
      return { status: "error" };
    }
  },
});

server.listen({ host: "0.0.0.0", port: 8080 }, (err, address) => {
  if (err) {
    logger.error(err);
    process.exit(1);
  }
  logger.log(`Server listening at ${address}`);
});
