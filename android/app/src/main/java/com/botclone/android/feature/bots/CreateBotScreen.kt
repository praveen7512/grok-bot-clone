package com.botclone.android.feature.bots

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.botclone.android.feature.voice.VoiceSettingsEditor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateBotScreen(
    onBack: () -> Unit,
    onCreated: (String) -> Unit,
    viewModel: CreateBotViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val voices by viewModel.voices.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.created.collect(onCreated) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("New bot") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = state.name,
                onValueChange = viewModel::onName,
                label = { Text("Name") },
                placeholder = { Text("e.g. Jarvis") },
                singleLine = true,
                supportingText = { Text("${state.name.length}/${CreateBotUiState.MAX_NAME}") },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = state.persona,
                onValueChange = viewModel::onPersona,
                label = { Text("Persona (optional)") },
                placeholder = { Text("A friendly Android expert who replies in Hinglish…") },
                minLines = 3,
                maxLines = 6,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth(),
            )

            Text("Voice", style = MaterialTheme.typography.titleMedium)
            VoiceSettingsEditor(
                settings = state.voice,
                voices = voices,
                onVoice = viewModel::onVoice,
                onRate = viewModel::onRate,
                onEnabled = viewModel::onVoiceEnabled,
            )
            OutlinedButton(onClick = viewModel::preview, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.AutoMirrored.Outlined.VolumeUp, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text("Preview voice")
            }

            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

            Spacer(Modifier.height(4.dp))
            Button(
                onClick = viewModel::create,
                enabled = state.canSubmit,
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (state.creating) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.size(8.dp))
                        Text("Spinning up sandbox…")
                    }
                } else {
                    Text("Create bot")
                }
            }
            Text(
                "Creating a bot provisions its own container, context, memory and voice settings.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
