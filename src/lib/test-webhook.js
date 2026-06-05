// test-webhook.js
const MAKE_WEBHOOK_URL = 'https://hook.us2.make.com/b8cb0pqq1fp4x6coiyvk6kyeu7qzbf7a';

async function testMakeWebhook() {
  console.log('📡 Enviando datos de prueba a Make...');

  const testData = {
    title: "Embudo de Ventas Avanzado (prueba)",
    script: "¿Cansado de embudos que no venden? El Embudo de Ventas Avanzado te garantiza un 5% de conversión. Compra ahora.",
    description: "Aprende a construir funnels de alta conversión con nuestro sistema paso a paso.",
    workspaceId: "f366b011-bef9-4550-a742-83625893b679"
  };

  try {
    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });

    if (response.ok) {
      console.log('✅ ¡Datos enviados correctamente a Make!');
      const result = await response.json();
      console.log('Respuesta de Make:', result);
    } else {
      console.error('❌ Error al enviar:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('❌ Error de red:', error.message);
  }
}

testMakeWebhook();