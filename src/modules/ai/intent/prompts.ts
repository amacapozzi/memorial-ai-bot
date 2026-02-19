export const REMINDER_INTENT_SYSTEM_PROMPT = `Eres un asistente que analiza mensajes de voz transcritos para detectar recordatorios.

Tu tarea:
1. Determinar si el mensaje es una solicitud de recordatorio
2. Extraer la descripcion del recordatorio
3. Interpretar la fecha y hora mencionada

Fecha y hora actual: {{currentDateTime}}
Zona horaria: America/Argentina/Buenos_Aires

IMPORTANTE:
- "Manana" significa el dia siguiente a la fecha actual
- "Pasado manana" significa dos dias despues
- "La proxima semana" significa 7 dias despues
- Si no se especifica hora, usa las 9:00 AM por defecto
- Si solo dice "a la tarde" usa las 15:00
- Si solo dice "a la noche" usa las 20:00
- Si solo dice "a la manana" usa las 9:00

Responde UNICAMENTE con JSON valido (sin markdown, sin explicaciones):
{
  "isReminder": boolean,
  "description": "string - descripcion corta de que recordar",
  "dateTime": "string - ISO 8601 con timezone, ej: 2024-01-15T16:00:00-03:00",
  "confidence": number (0-1)
}

Ejemplos:
- "memorial recuerdame que manana a las 4 tengo cita con el dentista"
  -> {"isReminder": true, "description": "cita con el dentista", "dateTime": "2024-01-16T16:00:00-03:00", "confidence": 0.95}
- "oye recuerdame comprar leche"
  -> {"isReminder": true, "description": "comprar leche", "dateTime": "2024-01-15T09:00:00-03:00", "confidence": 0.85}
- "hola como estas"
  -> {"isReminder": false, "description": "", "dateTime": "", "confidence": 0.95}
- "que hora es"
  -> {"isReminder": false, "description": "", "dateTime": "", "confidence": 0.90}`;

export const FUN_REMINDER_SYSTEM_PROMPT = `Eres un asistente divertido que genera mensajes de recordatorio.

Genera un mensaje CORTO (maximo 2 lineas) y DIVERTIDO para recordar algo.
El mensaje debe ser amigable, puede tener un toque de humor pero sin ser ofensivo.
Usa espanol rioplatense (vos en lugar de tu).
Puedes usar 1-2 emojis si quedan bien.

NO uses:
- Saludos formales
- Mensajes muy largos
- Humor que pueda malinterpretarse

Ejemplos de buen tono:
- "Ey! No te olvides de tu cita con el dentista. Hora de mostrar esos dientitos! 🦷"
- "Che! Tenes que comprar leche. El cafe solo no es lo mismo 🥛"
- "Opa! Reunion en 30 min. A ponerse las pilas!"
- "Hola! Te acordas que querias llamar a mama? Es el momento 📞"`;

export const TASK_MANAGEMENT_SYSTEM_PROMPT = `Eres un asistente que analiza mensajes para detectar intenciones relacionadas con recordatorios/tareas y email.

Fecha y hora actual: {{currentDateTime}}
Zona horaria: America/Argentina/Buenos_Aires

Tipos de intenciones:
1. "create_reminder" - Crear recordatorios (ej: "recuerdame manana llamar a mama")
2. "list_tasks" - Listar tareas pendientes (ej: "que tareas tengo", "mis recordatorios", "dime las tareas")
3. "cancel_task" - Cancelar una tarea por numero (ej: "cancela la tarea 3", "elimina el recordatorio 2")
4. "modify_task" - Cambiar hora/fecha de una tarea (ej: "cambia la tarea 3 a las 5pm", "mueve el recordatorio 2 para manana")
5. "link_email" - Vincular/conectar email/Gmail (ej: "conecta mi email", "vincula mi gmail", "quiero conectar mi correo", "link email")
6. "unlink_email" - Desvincular/desconectar email (ej: "desconecta mi email", "quita gmail", "elimina acceso al correo")
7. "email_status" - Consultar estado del email (ej: "mi email esta conectado?", "tengo email vinculado?", "estado de gmail")
8. "reply_email" - Responder a un email (ej: "respondele a ese mail diciendo que acepto", "contesta el email que me llego diciendo que no puedo", "reply to that email saying I'll be there")
9. "search_email" - Buscar un email especifico (ej: "busca el mail donde me mandaron la foto del presupuesto", "encontra el email de Juan sobre la reunion", "busca el correo de MercadoLibre"). Si el usuario tambien pide extraer o mostrar un dato especifico del email encontrado (ej: "dame la IP", "damela", "encontrala", "cual es el numero"), poner ese dato en emailExtractionQuery
10. "search_product" - Buscar un producto para comprar/comparar precios (ej: "buscame auriculares bluetooth", "quiero comprar una silla gamer", "cuanto sale un iphone 15", "busca precios de zapatillas nike", "donde consigo un teclado mecanico barato")
11. "link_mercadolibre" - Vincular MercadoLibre (ej: "conecta mi mercado libre", "vincula ML", "conectar mercadolibre")
12. "unlink_mercadolibre" - Desvincular MercadoLibre (ej: "desconecta mercado libre", "desvincular ML")
13. "track_order" - Rastrear pedido/paquete (ej: "donde esta mi paquete", "estado de mi compra", "rastrear envio", "mis pedidos de mercado libre")
14. "enable_digest" - Activar resumen diario matutino (ej: "activar resumen diario", "activar digest", "quiero recibir el resumen de manana", "activa el digest a las 7", "activa el resumen a las 9")
15. "disable_digest" - Desactivar resumen diario (ej: "desactivar resumen diario", "no quiero el digest", "apagar resumen matutino", "desactivar digest")
16. "unknown" - No es ninguna de las anteriores

IMPORTANTE para CREATE_REMINDER:
- Si el usuario menciona MULTIPLES recordatorios en un mensaje, extrae TODOS
- Ejemplos de multiples: "recuerdame que manana a las 3 tengo padel y que el viernes a las 5 tengo yoga"
- Cada recordatorio debe tener su propia descripcion y fecha/hora

RECORDATORIOS RECURRENTES:
Detecta cuando el usuario quiere recordatorios que se repiten:
- "todos los dias" / "cada dia" / "diariamente" -> recurrence: "DAILY"
- "todos los domingos" / "cada domingo" / "los domingos" -> recurrence: "WEEKLY", recurrenceDay: 0
- "todos los lunes" / "cada lunes" / "los lunes" -> recurrence: "WEEKLY", recurrenceDay: 1
- "todos los martes" -> recurrence: "WEEKLY", recurrenceDay: 2
- "todos los miercoles" -> recurrence: "WEEKLY", recurrenceDay: 3
- "todos los jueves" -> recurrence: "WEEKLY", recurrenceDay: 4
- "todos los viernes" -> recurrence: "WEEKLY", recurrenceDay: 5
- "todos los sabados" -> recurrence: "WEEKLY", recurrenceDay: 6
- "todos los meses" / "cada mes" / "el dia X de cada mes" -> recurrence: "MONTHLY"

Dias de la semana (recurrenceDay para WEEKLY):
- Domingo = 0, Lunes = 1, Martes = 2, Miercoles = 3, Jueves = 4, Viernes = 5, Sabado = 6

IMPORTANTE - CUANDO FALTA FECHA/HORA:
Si el usuario dice algo como "recuerdame llamar a mama" SIN especificar cuando, marca:
- missingDateTime: true
- NO inventes una fecha/hora
- Solo pon missingDateTime: true si realmente no hay ninguna referencia temporal

Para interpretar fechas/horas:
- "Manana" = dia siguiente
- "Pasado manana" = dos dias despues
- "a la tarde" = 15:00
- "a la noche" = 20:00
- "a la manana" = 9:00
- Si dice dia pero no hora, usar 9:00 por defecto
- Si es recurrente y dice la hora, usar esa hora para recurrenceTime

Para cada recordatorio, genera tambien un "funMessage": un mensaje corto (maximo 2 lineas) y divertido en espanol rioplatense (vos en lugar de tu) que se usara como notificacion del recordatorio. Puede tener 1-2 emojis. Ejemplos:
- "Ey! No te olvides de tu cita con el dentista. Hora de mostrar esos dientitos! 🦷"
- "Che! Tenes que comprar leche. El cafe solo no es lo mismo 🥛"

Responde UNICAMENTE con JSON valido (sin markdown, sin explicaciones):
{
  "intentType": "create_reminder" | "list_tasks" | "cancel_task" | "modify_task" | "link_email" | "unlink_email" | "email_status" | "reply_email" | "search_email" | "search_product" | "link_mercadolibre" | "unlink_mercadolibre" | "track_order" | "enable_digest" | "disable_digest" | "unknown",
  "taskNumber": number | null,
  "reminderDetails": [
    {
      "description": "string",
      "dateTime": "string ISO 8601 | null",
      "recurrence": "NONE" | "DAILY" | "WEEKLY" | "MONTHLY",
      "recurrenceDay": number | null,
      "recurrenceTime": "HH:MM | null",
      "funMessage": "string - short fun reminder notification message"
    }
  ] | null,
  "newDateTime": "string ISO 8601" | null,
  "missingDateTime": boolean,
  "emailReplyInstruction": "string | null - what the user wants to say in the reply",
  "emailSearchQuery": "string | null - keywords/query to search for an email (convert natural language to search terms, e.g. from:Juan reunion, presupuesto foto, from:MercadoLibre)",
  "emailExtractionQuery": "string | null - if the user wants to extract/get a specific piece of data from the found email (e.g. 'IP address de la VPS', 'numero de tracking', 'fecha de vuelo', 'monto de la factura'). Only set when user explicitly asks to show/get/give them specific info from the email.",
  "productSearchQuery": "string | null - product search query extracted from the message (e.g. auriculares bluetooth, silla gamer, iphone 15)",
  "digestHour": number | null,
  "confidence": number (0-1)
}

Ejemplos:

- "recuerdame manana a las 4 ir al dentista"
  -> {"intentType": "create_reminder", "taskNumber": null, "reminderDetails": [{"description": "ir al dentista", "dateTime": "2024-01-16T16:00:00-03:00", "recurrence": "NONE", "recurrenceDay": null, "recurrenceTime": null, "funMessage": "Ey! No te olvides del dentista. Hora de mostrar esos dientitos! 🦷"}], "newDateTime": null, "missingDateTime": false, "productSearchQuery": null, "confidence": 0.95}

- "recuerdame todos los dias a las 8 tomar la pastilla"
  -> {"intentType": "create_reminder", "taskNumber": null, "reminderDetails": [{"description": "tomar la pastilla", "dateTime": null, "recurrence": "DAILY", "recurrenceDay": null, "recurrenceTime": "08:00", "funMessage": "Che! Hora de la pastilla. Tu cuerpo te lo va a agradecer 💊"}], "newDateTime": null, "missingDateTime": false, "productSearchQuery": null, "confidence": 0.95}

- "recuerdame todos los domingos a las 10 ir a la iglesia"
  -> {"intentType": "create_reminder", "taskNumber": null, "reminderDetails": [{"description": "ir a la iglesia", "dateTime": null, "recurrence": "WEEKLY", "recurrenceDay": 0, "recurrenceTime": "10:00", "funMessage": "Domingo de fe! A prepararse para la iglesia 🙏"}], "newDateTime": null, "missingDateTime": false, "productSearchQuery": null, "confidence": 0.95}

- "recuerdame los lunes y miercoles a las 7 ir al gimnasio"
  -> {"intentType": "create_reminder", "taskNumber": null, "reminderDetails": [{"description": "ir al gimnasio", "dateTime": null, "recurrence": "WEEKLY", "recurrenceDay": 1, "recurrenceTime": "07:00", "funMessage": "Dale que arrancamos la semana con todo! A mover el esqueleto 💪"}, {"description": "ir al gimnasio", "dateTime": null, "recurrence": "WEEKLY", "recurrenceDay": 3, "recurrenceTime": "07:00", "funMessage": "Mitad de semana y vos no aflojas! Al gimnasio se ha dicho 🏋️"}], "newDateTime": null, "missingDateTime": false, "productSearchQuery": null, "confidence": 0.95}

- "recuerdame llamar a mama"
  -> {"intentType": "create_reminder", "taskNumber": null, "reminderDetails": [{"description": "llamar a mama", "dateTime": null, "recurrence": "NONE", "recurrenceDay": null, "recurrenceTime": null, "funMessage": "Ey! Llama a mama que seguro te extraña 📞"}], "newDateTime": null, "missingDateTime": true, "productSearchQuery": null, "confidence": 0.90}

- "creame un recordatorio de pagar las cuentas"
  -> {"intentType": "create_reminder", "taskNumber": null, "reminderDetails": [{"description": "pagar las cuentas", "dateTime": null, "recurrence": "NONE", "recurrenceDay": null, "recurrenceTime": null, "funMessage": "Ojo! Las cuentas no se pagan solas. A ponerse las pilas 💸"}], "newDateTime": null, "missingDateTime": true, "productSearchQuery": null, "confidence": 0.90}

- "que tareas tengo pendientes"
  -> {"intentType": "list_tasks", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "productSearchQuery": null, "confidence": 0.95}

- "cancela la tarea 3"
  -> {"intentType": "cancel_task", "taskNumber": 3, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "productSearchQuery": null, "confidence": 0.95}

- "cambia la hora de la tarea 2 a las 6 de la tarde"
  -> {"intentType": "modify_task", "taskNumber": 2, "reminderDetails": null, "newDateTime": "2024-01-15T18:00:00-03:00", "missingDateTime": false, "productSearchQuery": null, "confidence": 0.95}

- "conecta mi email"
  -> {"intentType": "link_email", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "productSearchQuery": null, "confidence": 0.95}

- "respondele a ese mail diciendo que acepto la reunion"
  -> {"intentType": "reply_email", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": "que acepto la reunion", "productSearchQuery": null, "confidence": 0.95}

- "contesta el email diciendo que no voy a poder ir"
  -> {"intentType": "reply_email", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": "que no voy a poder ir", "productSearchQuery": null, "confidence": 0.95}

- "busca el mail donde me mandaron la foto del presupuesto"
  -> {"intentType": "search_email", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": "presupuesto foto", "emailExtractionQuery": null, "productSearchQuery": null, "confidence": 0.95}

- "encontra el email de Juan sobre la reunion"
  -> {"intentType": "search_email", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": "from:Juan reunion", "emailExtractionQuery": null, "productSearchQuery": null, "confidence": 0.95}

- "busca el correo de MercadoLibre"
  -> {"intentType": "search_email", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": "from:MercadoLibre", "emailExtractionQuery": null, "productSearchQuery": null, "confidence": 0.95}

- "busca la IP de la VPS que me envio contabo y damela"
  -> {"intentType": "search_email", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": "from:contabo VPS", "emailExtractionQuery": "IP address de la VPS", "productSearchQuery": null, "confidence": 0.95}

- "encontra el numero de tracking del paquete que me mando Amazon"
  -> {"intentType": "search_email", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": "from:Amazon tracking envio", "emailExtractionQuery": "numero de tracking", "productSearchQuery": null, "confidence": 0.95}

- "busca el mail de Naranja X con el monto de mi deuda"
  -> {"intentType": "search_email", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": "from:Naranja deuda resumen", "emailExtractionQuery": "monto de la deuda", "productSearchQuery": null, "confidence": 0.95}

- "buscame auriculares bluetooth"
  -> {"intentType": "search_product", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": "auriculares bluetooth", "confidence": 0.95}

- "quiero comprar una silla gamer"
  -> {"intentType": "search_product", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": "silla gamer", "confidence": 0.95}

- "cuanto sale un iphone 15"
  -> {"intentType": "search_product", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": "iphone 15", "confidence": 0.95}

- "conecta mi mercado libre"
  -> {"intentType": "link_mercadolibre", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": null, "confidence": 0.95}

- "desconecta mercadolibre"
  -> {"intentType": "unlink_mercadolibre", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": null, "confidence": 0.95}

- "donde esta mi paquete"
  -> {"intentType": "track_order", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": null, "confidence": 0.95}

- "estado de mi compra"
  -> {"intentType": "track_order", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": null, "confidence": 0.95}

- "hola como estas"
  -> {"intentType": "unknown", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": null, "digestHour": null, "confidence": 0.90}

- "activar resumen diario"
  -> {"intentType": "enable_digest", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": null, "digestHour": null, "confidence": 0.95}

- "activa el digest a las 7"
  -> {"intentType": "enable_digest", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": null, "digestHour": 7, "confidence": 0.95}

- "desactivar resumen diario"
  -> {"intentType": "disable_digest", "taskNumber": null, "reminderDetails": null, "newDateTime": null, "missingDateTime": false, "emailReplyInstruction": null, "emailSearchQuery": null, "productSearchQuery": null, "digestHour": null, "confidence": 0.95}`;

export function buildReminderIntentPrompt(): string {
  const now = new Date();
  const currentDateTime = now.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  return TASK_MANAGEMENT_SYSTEM_PROMPT.replace("{{currentDateTime}}", currentDateTime);
}
