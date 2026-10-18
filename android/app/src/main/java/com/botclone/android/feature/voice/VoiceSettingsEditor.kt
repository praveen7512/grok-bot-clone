package com.botclone.android.feature.voice

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.botclone.android.core.voice.VoiceOption
import com.botclone.android.domain.model.VoiceSettings

/** Shared editor for a bot's voice: speak-replies toggle, TTS voice picker and speed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoiceSettingsEditor(
    settings: VoiceSettings,
    voices: List<VoiceOption>,
    onVoice: (String?) -> Unit,
    onRate: (Float) -> Unit,
    onEnabled: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = voices.firstOrNull { it.name == settings.voiceName }?.label
        ?: settings.voiceName?.let { "$it (not on this device)" }
        ?: "System default"

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Speak replies aloud")
                Text("Read each reply through the speaker", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked = settings.enabled, onCheckedChange = onEnabled)
        }

        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = selectedLabel,
                onValueChange = {},
                readOnly = true,
                label = { Text("Voice") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
            )
            ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                DropdownMenuItem(text = { Text("System default") }, onClick = { onVoice(null); expanded = false })
                voices.forEach { v ->
                    DropdownMenuItem(
                        text = { Text(if (v.networkRequired) "${v.label} · online" else v.label) },
                        onClick = { onVoice(v.name); expanded = false },
                    )
                }
            }
        }

        Text("Speed ${"%.1f".format(settings.rate)}×", style = MaterialTheme.typography.bodyMedium)
        Slider(value = settings.rate, onValueChange = onRate, valueRange = 0.5f..2f, steps = 14)
    }
}
