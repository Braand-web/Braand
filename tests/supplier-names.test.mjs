import assert from 'node:assert/strict';
import test from 'node:test';
import {withoutSupplierNames} from '../lib/supplier-names.mjs';

test('messages reaching a user name the kind of service, never the supplier', () => {
  assert.equal(withoutSupplierNames('fal.ai n’est pas configuré.'), 'le service de création n’est pas configuré.');
  assert.equal(withoutSupplierNames('Coût OpenRouter temporairement indisponible.'), 'Coût le service d’IA temporairement indisponible.'.replace('Coût le', 'Coût le'));
  assert.equal(withoutSupplierNames('La vérification SasPay a échoué.'), 'La vérification le service de paiement a échoué.');
  assert.equal(withoutSupplierNames('Ce modèle est introuvable sur fal.ai.'), 'Ce modèle est introuvable sur le service de création.');
  assert.equal(withoutSupplierNames('Vérifiez dans Composio la configuration'), 'Vérifiez dans le service de connexion la configuration');
  for (const text of ['Prix introuvable chez fal pour ce modèle', 'Browserbase ne répond pas', 'Cloudflare indisponible', 'Anthropic surchargé'])
    assert.doesNotMatch(withoutSupplierNames(text), /fal\b|browserbase|cloudflare|anthropic/i, text);
});

test('technical model identifiers and unrelated words stay intact', () => {
  assert.equal(withoutSupplierNames('Modèle fal-ai/flux/dev activé.'), 'Modèle fal-ai/flux/dev activé.');
  assert.equal(withoutSupplierNames('Votre solde est insuffisant.'), 'Votre solde est insuffisant.');
  assert.equal(withoutSupplierNames('Un festival très animé'), 'Un festival très animé');
  assert.equal(withoutSupplierNames(undefined), undefined);
});
