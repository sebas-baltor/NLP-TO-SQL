import readline from 'readline';
import { BigQuery } from '@google-cloud/bigquery';
import {OpenAI} from "openai"

// // Set up the OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// // Initialize BigQuery client
const bigquery = new BigQuery({
  projectId: process.env.GOOGLE_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    private_key_id:process.env.GOOGLE_PRIVATE_KEY_ID,
    client_id:process.env.GOOGLE_CLIENT_ID,
  }
});

// // Define the function specification for executing SQL queries
const functionSpec = {
  name: "execute_sql",
  description: "Executes a SQL query on Google BigQuery and returns the results.",
  parameters: {
    type: "object",
    properties: {
      sql_query: {
        type: "string",
        description: "The SQL query to execute on BigQuery."
      }
    },
    required: ["sql_query"]
  }
};

async function askGPT(messages) {
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: messages,
      max_tokens: 16384,
      functions: [functionSpec],
      function_call: null
    });
    // logger.info("GPT-4 response received.");
    return response;
  } catch (error) {
    // logger.error(`Error communicating with OpenAI: ${error}`);
    return null;
  }
}

async function executeSqlQuery(sqlQuery) {
  console.info("Starting execution of SQL query");
  try {
    // logger.info(`Executing SQL Query: ${sqlQuery}`);
    const [rows] = await bigquery.query(sqlQuery);
    // logger.info(`Query executed successfully. Retrieved ${rows.length} rows.`);
    console.log(rows);
    return rows;
  } catch (error) {
    // logger.error(`Error executing SQL query: ${error}`);
    return { error: error.message };
  } finally {
    console.info("SQL query execution process completed");
  }
}

function formatResults(results) {
  if (!results || results.length === 0) {
    return "The query returned no results.";
  }

  let formatted = "Here are the results:\n";
  results.forEach((row, index) => {
    const rowInfo = Object.entries(row).map(([key, value]) => `${key}: ${value}`).join(' | ');
    formatted += `${index + 1}. ${rowInfo}\n`;
  });
  console.log(formatted);
  return formatted;
}

async function summarizeResults(formatted) {
  try {
    const summaryMessages = [
      {
        role: "user",
        content: `Please provide a natural language response of everything you see do not summarize it:\n${formatted}`
      }
    ];

    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: summaryMessages,
      max_tokens: 16384,
      stream: true,
    });

    console.info("Natural language summary streamed successfully.");
    let collectedResponse = "";
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        const chunkContent = chunk.choices[0].delta.content;
        collectedResponse += chunkContent;
        process.stdout.write(chunkContent);
      }
    }
    console.log(); // For a newline after streaming
    return collectedResponse.trim();
  } catch (error) {
    console.error(`Error generating summary: ${error}`);
    return "I'm sorry, but I couldn't generate a summary based on the data.";
  }
}

async function main() {
  const messages = [
    {
      role: "system",
      content: (
        "You are a helpful AI assistant for a car service agency. " +
        "You can execute SQL queries on a BigQuery database and provide natural language responses based on the data. " +
        "The database schema includes a 'car_service_leads' dataset with a 'leads' table. " +
        "The 'leads' table has the following columns: lead_id (STRING), full_name (STRING), email (STRING), " +
        "phone_number (STRING), car_make (STRING), car_model (STRING), car_year (INTEGER), service_type (STRING), " +
        "preferred_date (DATE), and created_at (TIMESTAMP). This table contains information about potential customers and their service requests."
      )
    }
  ];

  console.log("Welcome to the Car Service Agency AI Assistant!");
  console.log("Type 'exit' to quit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const promptUser = () => {
    rl.question("You: ", async (userInput) => {
      if (userInput.toLowerCase() === 'exit') {
        console.log("Goodbye!");
        rl.close();
        return;
      }

      messages.push({ role: "user", content: userInput });

      const response = await askGPT(messages);
      if (!response) {
        console.log("Assistant: Sorry, I'm experiencing some issues right now. Please try again later.\n");
        promptUser();
        return;
      }

      const message = response.choices[0].message;

      if (message.function_call) {
        const functionName = message.function_call.name;
        const functionArgs = JSON.parse(message.function_call.arguments);

        if (functionName === "execute_sql") {
          const sqlQuery = functionArgs.sql_query;
          if (!sqlQuery) {
            console.log("Assistant: I'm sorry, I couldn't identify the SQL query to execute.");
            // logger.warning("No SQL query provided in function call.");
          } else {
            console.log(`\nExecuting SQL Query: ${sqlQuery}\n`);

            const results = await executeSqlQuery(sqlQuery);

            let assistantResponse;
            if ("error" in results) {
              assistantResponse = `An error occurred while executing the query: ${results.error}`;
            } else {
              const formatted = formatResults(results);
              assistantResponse = await summarizeResults(formatted);
            }

            messages.push({ role: "assistant", content: assistantResponse });
            // console.log(`Assistant: ${assistantResponse}\n`);
            return;
          }
        } else {
          const assistantResponse = "I'm sorry, I don't know how to help with that.";
          messages.push({ role: "assistant", content: assistantResponse });
          console.log(`Assistant: ${assistantResponse}\n`);
        }
      } else {
        const assistantResponse = message.content;
        messages.push({ role: "assistant", content: assistantResponse });
        console.log(`Assistant: ${assistantResponse}\n`);
      }

      promptUser();
    });
  };

  promptUser();
}

main();