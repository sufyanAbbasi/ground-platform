/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { DialogService } from '../../services/dialog/dialog.service';
import { Job } from '../../shared/models/job.model';
import { Subscription } from 'rxjs';
import { StepType, Step } from '../../shared/models/task/step.model';
import { List } from 'immutable';
import { MarkerColorEvent } from '../edit-style-button/edit-style-button.component';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { JobService } from '../../services/job/job.service';
import { TaskEditorComponent } from '../task-editor/task-editor.component';
import { NavigationService } from '../../services/navigation/navigation.service';

// To make ESLint happy:
/*global alert*/

@Component({
  selector: 'ground-job-dialog',
  templateUrl: './job-dialog.component.html',
  styleUrls: ['./job-dialog.component.scss'],
})
export class JobDialogComponent implements OnDestroy {
  job?: Job;
  jobName!: string;
  surveyId?: string;
  subscription: Subscription = new Subscription();
  stepTypes = StepType;
  steps: List<Step>;
  color!: string;
  defaultJobColor: string;
  @ViewChildren(TaskEditorComponent)
  taskEditors?: QueryList<TaskEditorComponent>;
  dataCollectorsCanAddPoints = true;
  dataCollectorsCanAddPolygons = true;

  constructor(
    @Inject(MAT_DIALOG_DATA)
    data: {
      surveyId: string;
      job?: Job;
      createJob: boolean;
    },
    private dialogRef: MatDialogRef<JobDialogComponent>,
    private dialogService: DialogService,
    private jobService: JobService,
    private navigationService: NavigationService,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.defaultJobColor = '#ff9131';
    // Disable closing on clicks outside of dialog.
    dialogRef.disableClose = true;
    this.steps = List<Step>();
    this.init(data.surveyId, data.createJob, data.job);
    this.dialogRef.keydownEvents().subscribe(event => {
      if (event.key === 'Escape') {
        this.close();
      }
    });
  }

  addQuestion() {
    const newStep = this.jobService.createStep(
      StepType.TEXT,
      /* label= */
      '',
      /* required= */
      false,
      /* index= */
      this.steps.size
    );
    this.steps = this.steps.push(newStep);
    this.markTasksTouched();
    this.focusNewQuestion();
  }

  /**
   * Delete the step of a given index.
   *
   * @param index - The index of the step
   * @returns void
   *
   */
  onStepDelete(index: number) {
    this.dialogService
      .openConfirmationDialog(
        'Warning',
        'Are you sure you wish to delete this question? Any associated data ' +
          'will be lost. This cannot be undone.'
      )
      .afterClosed()
      .subscribe(dialogResult => {
        if (dialogResult) {
          this.steps = this.steps.splice(index, 1);
        }
      });
  }

  init(surveyId: string, createJob: boolean, job?: Job) {
    if (!createJob && !job) {
      console.warn('User passed an invalid job id');
    }
    this.surveyId = surveyId;
    this.job = job;
    this.jobName = this.job?.name || '';
    this.color = this.job?.color || this.defaultJobColor;
    if (!job) {
      this.job = this.jobService.createNewJob();
      this.addQuestion();
      return;
    }
    this.dataCollectorsCanAddPoints =
      this.job?.dataCollectorsCanAdd?.includes('points') || false;
    this.dataCollectorsCanAddPolygons =
      this.job?.dataCollectorsCanAdd?.includes('polygons') || false;
    if (this.job?.steps) {
      this.steps =
        this.job.steps.toList().sortBy(step => step.index) || List<Step>();
    } else {
      this.addQuestion();
    }
  }

  async onSave() {
    if (!this.surveyId) {
      throw Error('Survey not yet loaded');
    }

    if (!this.taskEditors) {
      return;
    }

    this.markTasksTouched();

    for (const editor of this.taskEditors) {
      if (editor.taskGroup.invalid || !this.isStepOptionsValid(editor)) {
        return;
      }
    }
    const steps = this.jobService.convertStepsListToMap(this.steps);
    const allowedLoiTypes: string[] = [];
    if (this.dataCollectorsCanAddPoints) {
      allowedLoiTypes.push('points');
    }
    if (this.dataCollectorsCanAddPolygons) {
      allowedLoiTypes.push('polygons');
    }
    const job = new Job(
      this.job?.id || '',
      /* index */ this.job?.index || -1,
      this.color,
      // TODO: Make jobName Map
      this.jobName.trim(),
      steps,
      allowedLoiTypes
    );
    this.addOrUpdateJob(this.surveyId, job);
  }

  private isStepOptionsValid(taskEditor: TaskEditorComponent): boolean {
    if (!taskEditor.optionEditors) {
      return true;
    }
    for (const editor of taskEditor.optionEditors) {
      if (editor.optionGroup.invalid) {
        return false;
      }
    }
    return true;
  }

  private addOrUpdateJob(surveyId: string, job: Job) {
    // TODO: Inform user job was saved
    this.jobService
      .addOrUpdateJob(surveyId, job)
      .then(() => this.close())
      .catch(err => {
        console.error(err);
        alert('Job update failed.');
      });
  }

  onCancel(): void {
    if (!this.hasUnsavedChanges()) {
      this.close();
      return;
    }
    this.dialogService
      .openConfirmationDialog(
        'Discard changes',
        'Unsaved changes to this job will be lost. Are you sure?',
        /* showDiscardActions= */ true
      )
      .afterClosed()
      .subscribe(async dialogResult => {
        if (dialogResult) {
          this.close();
        }
      });
  }

  setJobName(value: string) {
    this.jobName = value;
  }

  /**
   * Updates the step at given index from event emitted from task-editor
   *
   * @param index - The index of the step
   * @param event - updated step emitted from task-editor
   * @returns void
   *
   */
  onStepUpdate(event: Step, index: number) {
    const stepId = this.steps.get(index)?.id;
    const step = new Step(
      stepId || '',
      event.type,
      event.label,
      event.required,
      index,
      event.multipleChoice
    );
    this.steps = this.steps.set(index, step);
  }

  trackByFn(index: number) {
    return index;
  }

  drop(event: CdkDragDrop<string[]>) {
    const stepAtPrevIndex = this.steps.get(event.previousIndex);
    if (!stepAtPrevIndex) {
      return;
    }
    this.steps = this.steps.delete(event.previousIndex);
    this.steps = this.steps.insert(event.currentIndex, stepAtPrevIndex);
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  onMarkerColorChange(event: MarkerColorEvent) {
    this.color = event.color;
  }

  private markTasksTouched(): void {
    this.taskEditors?.forEach(editor => {
      this.markOptionsTouched(editor);
      editor.labelControl.markAsTouched();
    });
  }

  private markOptionsTouched(editor: TaskEditorComponent): void {
    editor.optionEditors?.forEach(editor => {
      editor.optionGroup.markAllAsTouched();
    });
  }

  private focusNewQuestion(): void {
    if (this.taskEditors?.length) {
      this.cdr.detectChanges();
      const question = this.taskEditors.last;
      question?.questionInput?.nativeElement.focus();
    }
  }

  private isStepOptionsDirty(taskEditor: TaskEditorComponent): boolean {
    if (!taskEditor.optionEditors) {
      return true;
    }
    for (const editor of taskEditor.optionEditors) {
      if (editor.optionGroup.dirty) {
        return false;
      }
    }
    return true;
  }

  private hasUnsavedChanges(): boolean {
    if (!this.taskEditors) {
      return false;
    }
    for (const editor of this.taskEditors) {
      if (editor.taskGroup.dirty || !this.isStepOptionsDirty(editor)) {
        return true;
      }
    }
    return false;
  }

  private close(): void {
    this.dialogRef.close();
    // TODO: Add closeJobDialog() in NavigationService that removes the job fragment.
    return this.navigationService.selectSurvey(this.surveyId!);
  }
}
